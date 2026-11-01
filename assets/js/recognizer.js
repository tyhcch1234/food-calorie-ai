/* 食物辨識引擎
 * 1) 離線引擎：Transformers.js + CLIP zero-shot（完全在瀏覽器執行，圖片不會離開裝置）
 * 2) API 引擎：OpenAI 相容的 Vision API（可填自己的 Key，支援多種食物與份量估算）
 */

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

let _pipelinePromise = null;
let _libLoaded = null;

async function loadLib(){
  if (!_libLoaded){
    _libLoaded = import(TRANSFORMERS_CDN);
  }
  return _libLoaded;
}

/**
 * 載入（或重用）CLIP 模型
 * @param {(p:{status:string,progress?:number,file?:string})=>void} onProgress
 */
async function getClassifier(onProgress){
  if (_pipelinePromise) return _pipelinePromise;
  _pipelinePromise = (async () => {
    const { pipeline, env } = await loadLib();
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    // 可用 ?modelHost=https://your-mirror/ 指定自架模型來源（例如內網或鏡像）
    let host = new URLSearchParams(location.search).get('modelHost');
    if (!host) { try { host = localStorage.getItem('foodcal.modelHost') || ''; } catch(e){} }
    if (host) env.remoteHost = host.replace(/\/?$/, '/');
    if (env.backends?.onnx?.wasm){
      // GitHub Pages 沒有 COOP/COEP header，單執行緒最穩定；
      // proxy = true 讓推理在 Web Worker 執行，避免下載／運算時畫面凍結
      try { env.backends.onnx.wasm.numThreads = 1; } catch(e){}
      try { env.backends.onnx.wasm.proxy = true; } catch(e){}
    }
    return pipeline('zero-shot-image-classification', MODEL_ID, {
      quantized: true,
      progress_callback: (p) => {
        if (!onProgress) return;
        if (p.status === 'progress' && p.file){
          onProgress({ status:'downloading', progress: p.progress || 0, file: p.file });
        } else if (p.status === 'ready'){
          onProgress({ status:'ready' });
        } else if (p.status){
          onProgress({ status: p.status });
        }
      }
    });
  })().catch(err => {
    _pipelinePromise = null;   // 失敗後允許重試（例如網絡恢復或換鏡像）
    throw err;
  });
  return _pipelinePromise;
}

/** 離線辨識：回傳 [{foodId, score}]，已排序 */
async function recognizeOffline(imageSource, { onProgress, labels } = {}){
  const clf = await getClassifier(onProgress);
  const list = labels && labels.length ? labels : CLIP_LABELS;
  const promptOf = new Map(list.map(l => [l.p, l.id]));

  const results = await clf(imageSource, list.map(l => l.p), {
    hypothesis_template: 'This is a photo of {}.'
  });

  const seen = new Set();
  const mapped = [];
  for (const r of results){
    const id = promptOf.get(r.label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mapped.push({ foodId: id, score: r.score });
  }
  return mapped;
}

/* ---------- Vision API（OpenAI 相容） ---------- */

const DEFAULT_API = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini'
};

function fileToDataURL(file){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/** 壓縮圖片，減少 API token 與上傳時間 */
async function shrinkImage(file, maxSide = 1024, quality = 0.85){
  const dataUrl = await fileToDataURL(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale >= 1 && file.size < 700 * 1024) return dataUrl;
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', quality);
}

function loadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const API_PROMPT = `你是營養分析助手。請辨識這張相片裡所有可食用的食物/飲品，估算每一項的份量（克），並回傳嚴格 JSON。
只輸出 JSON，不要任何說明文字或 markdown 符號。格式：
{"items":[{"name_zh":"白飯","name_en":"steamed white rice","grams":180,"confidence":0.9}],
 "scene":"一句話描述整張相片的內容","note":"份量估算的依據（例如：以常見餐盤比例推算）"}
規則：
- grams 為可食部分重量，必須是 5 至 2000 之間的數字。
- 最多 8 項；只列出相片中真正看得到的食物。
- 若有多種食物，逐項分開列出（例如「叉燒飯」請拆成「白飯」「叉燒」）。
- confidence 為 0 到 1 的信心值。`;

async function recognizeWithAPI(file, settings){
  const dataUrl = await shrinkImage(file);
  const base = (settings.baseUrl || DEFAULT_API.baseUrl).replace(/\/+$/, '');
  const model = settings.model || DEFAULT_API.model;
  const body = {
    model,
    temperature: 0.2,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: API_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }]
  };
  if (!/gemini/i.test(base)) body.response_format = { type: 'json_object' };

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + settings.apiKey
    },
    body: JSON.stringify(body)
  });

  if (!res.ok){
    const txt = await res.text().catch(() => '');
    throw new Error(`API 回應 ${res.status}：${txt.slice(0, 200) || res.statusText}`);
  }
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content || '';
  const parsed = parseJsonLoose(raw);
  if (!parsed || !Array.isArray(parsed.items)) throw new Error('API 回傳格式無法解析');
  return parsed;
}

function parseJsonLoose(text){
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch(e){}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start){
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch(e){}
  }
  return null;
}

/* ---------- 名稱比對到食物資料庫 ---------- */

function norm(s){
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_.,，。、（）()\/]/g, '')
    .replace(/[（）]/g, '');
}

/** 將 API 回傳的名稱對應到 FOODS，找不到回傳 null */
function matchFood(nameZh, nameEn){
  const zh = norm(nameZh);
  const en = norm(nameEn);

  // 1. 完全相符
  let hit = FOODS.find(f => norm(f.n) === zh || (en && norm(f.e) === en));
  if (hit) return hit;

  // 2. 包含關係（取最長匹配，避免「飯」對到「炒飯」）
  const candidates = [];
  FOODS.forEach(f => {
    const fn = norm(f.n), fe = norm(f.e);
    const parts = fn.split('/').map(p => p.trim()).filter(Boolean);
    const names = [fn, ...parts];
    names.forEach(nm => {
      if (nm.length >= 2 && (zh.includes(nm) || nm.includes(zh) && zh.length >= 2)) candidates.push({ f, len: nm.length });
      if (en && fe && (en.includes(fe) || fe.includes(en)) && fe.length >= 3) candidates.push({ f, len: fe.length });
    });
  });
  if (candidates.length){
    candidates.sort((a, b) => b.len - a.len);
    return candidates[0].f;
  }

  // 3. 字元重疊度（中文）
  if (zh){
    let best = null, bestScore = 0;
    const zs = new Set(zh.split(''));
    FOODS.forEach(f => {
      const fs = new Set(norm(f.n).split(''));
      let inter = 0;
      zs.forEach(c => { if (fs.has(c)) inter++; });
      const score = inter / Math.max(zs.size, fs.size);
      if (score > bestScore){ bestScore = score; best = f; }
    });
    if (bestScore >= 0.6) return best;
  }
  return null;
}

window.FoodRecognizer = {
  recognizeOffline,
  recognizeWithAPI,
  matchFood,
  shrinkImage,
  loadImage,
  getClassifier,
  DEFAULT_API,
  MODEL_ID
};
