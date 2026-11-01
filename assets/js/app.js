/* 介面邏輯 */
(function(){
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const LS_KEY = 'foodcal.settings.v1';
  const LS_MEAL = 'foodcal.meal.v1';
  const LS_TARGET = 'foodcal.target.v1';

  const state = {
    items: [],          // [{uid, foodId, grams}]
    candidates: [],     // [{foodId, score, raw?}]
    target: 2000,
    useApi: false,
    settings: { baseUrl:'', model:'', apiKey:'' },
    busy: false,
    lastFile: null,
    objectUrl: null
  };

  const CAT_COLOR = {
    '主食':'#f2a03d', '中式菜':'#e2603f', '肉類':'#c0392b', '海鮮':'#2f80ed',
    '蔬菜':'#2fa36b', '水果':'#e05f8a', '蛋豆奶':'#c9a227', '湯品':'#8a7fd6',
    '快餐':'#a0522d', '小食':'#b8860b', '甜品':'#d46fa8', '飲品':'#3aa6b9', '醬料':'#8d8d8d'
  };

  /* ---------------- 初始化 ---------------- */
  function init(){
    loadStored();
    bindUpload();
    bindModals();
    bindTarget();
    renderQuickCats();
    renderMeal();
    renderTotals();
    $('#use-api').checked = state.useApi;
    updateEngineNote();
    $('#daily-target').value = state.target;
    // 上次的餐點仍在：直接顯示分析區（不滾動）
    if (state.items.length){
      $('#workspace').hidden = false;
      $('#library-teaser').hidden = true;
      $('.photo-card').hidden = true;
    }
  }

  function loadStored(){
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s){
        state.settings = Object.assign(state.settings, s);
        state.useApi = !!s.apiKey;
      }
    } catch(e){}
    try {
      const t = parseInt(localStorage.getItem(LS_TARGET) || '', 10);
      if (t >= 800) state.target = t;
    } catch(e){}
    try {
      const m = JSON.parse(localStorage.getItem(LS_MEAL) || 'null');
      if (Array.isArray(m)) state.items = m.filter(it => getFood(it.foodId));
    } catch(e){}
    $('#api-base').value = state.settings.baseUrl || '';
    $('#api-model').value = state.settings.model || '';
    $('#api-key').value = state.settings.apiKey || '';
    try { $('#model-host').value = localStorage.getItem('foodcal.modelHost') || ''; } catch(e){}
    state.useApi = !!(state.settings.apiKey && state.settings.useApi);
  }

  function saveSettings(){
    localStorage.setItem(LS_KEY, JSON.stringify(Object.assign({}, state.settings, { useApi: state.useApi })));
  }
  function saveMeal(){
    localStorage.setItem(LS_MEAL, JSON.stringify(state.items));
  }

  /* ---------------- 上載 ---------------- */
  function bindUpload(){
    const dz = $('#dropzone');
    const fileInput = $('#file-input');
    const camInput = $('#camera-input');

    $('#btn-pick').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    $('#btn-camera').addEventListener('click', e => { e.stopPropagation(); camInput.click(); });
    dz.addEventListener('click', () => fileInput.click());
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fileInput.click(); } });

    fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ''; });
    camInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ''; });

    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.add('dragging');
    }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.remove('dragging');
    }));
    dz.addEventListener('drop', e => {
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) onFile(f);
    });

    document.addEventListener('paste', e => {
      const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
      if (item){ const f = item.getAsFile(); if (f) onFile(f); }
    });

    $('#btn-change').addEventListener('click', () => $('#file-input').click());
    $('#btn-reanalyze').addEventListener('click', () => { if (state.lastFile) analyze(state.lastFile); });
    $('#btn-search').addEventListener('click', () => openSearch());

    $('#btn-demo').addEventListener('click', async e => {
      e.stopPropagation();
      try {
        const res = await fetch('demo/sample-fried-rice.jpg');
        const blob = await res.blob();
        onFile(new File([blob], 'demo-fried-rice.jpg', { type: blob.type || 'image/jpeg' }));
      } catch(err){
        toast('示範相片載入失敗：' + err.message);
      }
    });
  }

  function showProgress(label, pct){
    const box = $('#upload-progress');
    const ws = $('#workspace');
    if (pct === null){
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (ws.hidden) { /* keep upload card visible */ }
    $('#up-label').textContent = label;
    $('#up-pct').textContent = Math.round(pct) + '%';
    $('#up-bar').style.width = Math.max(2, Math.min(100, pct)) + '%';
  }

  async function onFile(file){
    state.lastFile = file;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    $('#preview').src = state.objectUrl;
    $('#workspace').hidden = false;
    $('.photo-card').hidden = false;
    $('#library-teaser').hidden = true;
    $('#dropzone').classList.add('compact');
    $('#scene').hidden = true;
    $('#workspace').scrollIntoView({ behavior:'smooth', block:'start' });
    await analyze(file);
  }

  /* ---------------- 分析 ---------------- */
  async function analyze(file){
    if (state.busy) return;
    state.busy = true;
    $('#btn-reanalyze').disabled = true;
    $('#photo-badge').hidden = false;
    $('#photo-badge').textContent = '分析中…';
    renderCandidatesLoading();

    const wantApi = state.useApi && state.settings.apiKey;
    $('#engine-tag').textContent = wantApi ? 'Vision API' : '離線模型';

    try {
      if (wantApi){
        showProgress('正在把相片傳送到 Vision API…', 45);
        const result = await FoodRecognizer.recognizeWithAPI(file, state.settings);
        showProgress('整理辨識結果…', 90);
        applyApiResult(result);
        showProgress(null);
      } else {
        showProgress('載入 AI 模型（首次約 150MB）…', 3);
        const imgUrl = await FoodRecognizer.shrinkImage(file, 640, 0.9);
        const list = await FoodRecognizer.recognizeOffline(imgUrl, {
          onProgress: p => {
            if (p.status === 'downloading') showProgress('下載模型 ' + (p.file || ''), Math.min(85, 3 + (p.progress || 0) * 0.82));
            else if (p.status === 'ready') showProgress('模型就緒，開始辨識…', 88);
            else showProgress('準備模型…', 10);
          }
        });
        showProgress('比對食物資料庫…', 95);
        applyOfflineResult(list);
        showProgress(null);
      }
      $('#photo-badge').hidden = true;
    } catch (err){
      console.error(err);
      showProgress(null);
      $('#photo-badge').hidden = true;
      renderCandidatesError(err);
      toast('辨識失敗：' + (err.message || err));
    } finally {
      state.busy = false;
      $('#btn-reanalyze').disabled = false;
    }
  }

  function applyOfflineResult(list){
    state.candidates = list.slice(0, 5)
      .filter(c => getFood(c.foodId))
      .map(c => ({ foodId: c.foodId, score: c.score }));
    renderCandidates();

    // 自動加入最高分（信心足夠時），讓「上載即計算」成立
    const top = state.candidates[0];
    if (top && top.score >= 0.28 && !state.items.some(it => it.foodId === top.foodId)){
      addItem(top.foodId, defaultGrams(top.foodId), true);
    }
    if (!state.candidates.length) renderCandidatesError(new Error('沒有認出可對應的食物'));
  }

  function applyApiResult(result){
    const matched = [];
    const unmatched = [];
    (result.items || []).forEach(it => {
      const f = FoodRecognizer.matchFood(it.name_zh || it.name, it.name_en);
      if (f) matched.push({ foodId: f.id, score: it.confidence ?? 0.8, grams: it.grams, name: it.name_zh || it.name });
      else unmatched.push(it.name_zh || it.name_en || it.name || '未知食物');
    });

    state.candidates = matched.map(m => ({ foodId: m.foodId, score: m.score, apiName: m.name }));
    renderCandidates();
    if (result.scene){
      $('#scene').textContent = 'AI 描述：' + result.scene + (result.note ? '（' + result.note + '）' : '');
      $('#scene').hidden = false;
    }
    let added = 0;
    matched.forEach(m => {
      const g = Math.max(5, Math.min(2000, Number(m.grams) || defaultGrams(m.foodId)));
      addItem(m.foodId, Math.round(g), true);
      added++;
    });
    if (unmatched.length){
      const box = $('#candidates');
      box.insertAdjacentHTML('beforeend',
        `<div class="unmatched">資料庫未收錄：${unmatched.map(esc).join('、')} — 請用「手動搜尋食物」加入最接近的項目。</div>`);
    }
    if (!added && !unmatched.length) renderCandidatesError(new Error('API 沒有回傳任何食物'));
  }

  /** 顯示分析區（手動加入食物時也要看得到） */
  function ensureWorkspace(){
    const ws = $('#workspace');
    const firstOpen = ws.hidden;
    ws.hidden = false;
    $('#library-teaser').hidden = true;
    $('.photo-card').hidden = !state.lastFile;
    if (firstOpen){
      ws.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  }

  function defaultGrams(foodId){
    const f = getFood(foodId);
    if (!f) return 100;
    return f.u && f.u[0] ? f.u[0][1] : 100;
  }

  /* ---------------- 候選清單 ---------------- */
  function renderCandidatesLoading(){
    $('#candidates').innerHTML = `
      <div class="skel-row"><span class="skel" style="width:38%"></span><span class="skel" style="width:22%"></span></div>
      <div class="skel-row"><span class="skel" style="width:30%"></span><span class="skel" style="width:18%"></span></div>
      <div class="skel-row"><span class="skel" style="width:44%"></span><span class="skel" style="width:14%"></span></div>`;
  }

  function renderCandidates(){
    const box = $('#candidates');
    if (!state.candidates.length){
      box.innerHTML = `<p class="muted">沒有辨識結果，請手動搜尋。</p>`;
      return;
    }
    box.innerHTML = state.candidates.map((c, i) => {
      const f = getFood(c.foodId);
      if (!f) return '';
      const conf = Math.round((c.score || 0) * 100);
      const level = conf >= 55 ? 'high' : conf >= 30 ? 'mid' : 'low';
      const label = conf >= 55 ? '很可能' : conf >= 30 ? '可能' : '不確定';
      return `
        <button class="cand" type="button" data-add="${f.id}" data-idx="${i}">
          <span class="cand-dot" style="background:${CAT_COLOR[f.c] || '#999'}"></span>
          <span class="cand-name">${esc(f.n)}<small>${esc(f.e)}</small></span>
          <span class="cand-conf ${level}">${label} ${conf}%</span>
          <span class="cand-add">＋</span>
        </button>`;
    }).join('') + (state.candidates[0] && state.candidates[0].score < 0.28
      ? `<p class="hint">信心偏低：相片可能有多種食物或角度不利辨識，建議用「手動搜尋食物」確認。</p>` : '')
      + `<p class="hint">按一下候選即加入餐點；份量可在右邊調整。</p>`;

    $$('.cand', box).forEach(btn => {
      btn.addEventListener('click', () => {
        addItem(btn.dataset.add, defaultGrams(btn.dataset.add));
      });
    });
  }

  function renderCandidatesError(err){
    $('#candidates').innerHTML = `
      <div class="notice error">
        <b>未能完成自動辨識</b>
        <p>${esc(err.message || String(err))}</p>
        <p class="small">可改用「手動搜尋食物」；若使用離線模型，請確認網絡可連到 cdn.jsdelivr.net 與 huggingface.co。若所在地區無法連線 huggingface.co，可在「設定」填寫模型鏡像網址後重新載入。</p>
      </div>`;
  }

  /* ---------------- 餐點 ---------------- */
  function addItem(foodId, grams, silent){
    const f = getFood(foodId);
    if (!f) return;
    const exist = state.items.find(it => it.foodId === foodId);
    if (exist && silent){
      return; // 避免重複加入同一食物
    }
    ensureWorkspace();
    state.items.push({ uid: 'i' + Date.now() + Math.random().toString(36).slice(2, 6), foodId, grams: Math.round(grams) });
    saveMeal();
    renderMeal();
    renderTotals();
    if (!silent) toast('已加入：' + f.n);
  }

  function renderMeal(){
    const list = $('#meal-list');
    $('#meal-empty').hidden = state.items.length > 0;
    list.innerHTML = state.items.map(it => {
      const f = getFood(it.foodId);
      if (!f) return '';
      const n = nutritionFor(f, it.grams);
      const max = Math.max(600, it.grams * 2, (f.u[0] ? f.u[0][1] * 3 : 300));
      const units = (f.u || []).map(([name, g]) =>
        `<button type="button" class="unit" data-uid="${it.uid}" data-g="${g}">${esc(name)} ${g}g</button>`).join('');
      return `
        <li class="meal-item" data-uid="${it.uid}">
          <div class="mi-top">
            <span class="cand-dot" style="background:${CAT_COLOR[f.c] || '#999'}"></span>
            <div class="mi-name">${esc(f.n)}<small>${esc(f.e)} · 每100g ${f.k} kcal</small></div>
            <div class="mi-kcal">${fmt(n.k)}<em>kcal</em></div>
            <button class="icon-btn mi-del" data-del="${it.uid}" type="button" aria-label="移除">×</button>
          </div>
          <div class="mi-ctrl">
            <input type="range" min="5" max="${Math.round(max)}" step="5" value="${it.grams}" data-range="${it.uid}" aria-label="${esc(f.n)} 份量">
            <div class="mi-grams">
              <input type="number" min="1" max="2000" step="1" value="${it.grams}" data-num="${it.uid}" aria-label="份量克數">
              <span>g</span>
            </div>
          </div>
          <div class="mi-units">${units}</div>
        </li>`;
    }).join('');

    // 事件
    $$('[data-range]', list).forEach(el => el.addEventListener('input', e => {
      updateGrams(el.dataset.range, Number(e.target.value), 'range');
    }));
    $$('[data-num]', list).forEach(el => {
      el.addEventListener('focus', () => el.select());
    });
    $$('[data-num]', list).forEach(el => el.addEventListener('change', e => {
      let v = Number(e.target.value);
      if (!isFinite(v) || v < 1) v = 1;
      if (v > 2000) v = 2000;
      updateGrams(el.dataset.num, v, 'num');
    }));
    $$('[data-del]', list).forEach(el => el.addEventListener('click', () => {
      state.items = state.items.filter(it => it.uid !== el.dataset.del);
      saveMeal(); renderMeal(); renderTotals();
    }));
    $$('.unit', list).forEach(el => el.addEventListener('click', () => {
      updateGrams(el.dataset.uid, Number(el.dataset.g), 'both');
    }));
  }

  function updateGrams(uid, grams, source){
    const it = state.items.find(x => x.uid === uid);
    if (!it) return;
    it.grams = Math.max(1, Math.min(2000, Math.round(grams)));
    saveMeal();
    const li = $(`.meal-item[data-uid="${uid}"]`);
    if (li){
      // 兩個控制項都同步成「夾限後」的數值，避免輸入框顯示未修正的內容
      const r = $('[data-range]', li);
      if (r){ r.value = it.grams; }
      const n = $('[data-num]', li);
      if (n){ n.value = it.grams; }
      const f = getFood(it.foodId);
      const v = nutritionFor(f, it.grams);
      const kc = $('.mi-kcal', li);
      if (kc) kc.innerHTML = fmt(v.k) + '<em>kcal</em>';
    }
    renderTotals();
  }

  /* ---------------- 總結 ---------------- */
  function renderTotals(){
    const t = totalOf(state.items);
    const grams = state.items.reduce((a, b) => a + b.grams, 0);
    $('#total-kcal').textContent = fmt(t.k);
    $('#total-sub').textContent = `共 ${state.items.length} 項 · ${fmt(grams)} g`;

    const split = macroSplitOf(t);
    $('#donut').innerHTML = donutSVG(split, fmt(t.k));

    const rows = [
      { key:'p',  name:'蛋白質', val:t.p,  unit:'g', color:'#3E7BFA', ref:DAILY_REF.p },
      { key:'cb', name:'碳水化合物', val:t.cb, unit:'g', color:'#F2A63B', ref:DAILY_REF.cb },
      { key:'f',  name:'脂肪',   val:t.f,  unit:'g', color:'#FF5C7C', ref:DAILY_REF.f }
    ];
    $('#macros').innerHTML = rows.map(r => {
      const p100 = split[r.key] || 0;
      const dpct = pct(r.val, r.ref);
      return `
        <div class="macro">
          <div class="macro-head">
            <span class="swatch" style="background:${r.color}"></span>
            <span class="macro-name">${r.name}</span>
            <span class="macro-val">${fmt(r.val, 1)} g</span>
            <span class="macro-pct">${fmt(p100)}% 熱量</span>
          </div>
          <div class="bar soft"><i style="width:${Math.min(100, p100)}%;background:${r.color}"></i></div>
          <div class="macro-sub">每日參考 ${r.ref} g 的 ${fmt(dpct)}%</div>
        </div>`;
    }).join('');

    $('#micro').innerHTML = [
      { name:'膳食纖維', val:t.fi, unit:'g', ref:DAILY_REF.fi, d:0 },
      { name:'糖', val:t.su, unit:'g', ref:DAILY_REF.su, d:1 },
      { name:'鈉', val:t.na, unit:'mg', ref:DAILY_REF.na, d:0 }
    ].map(m => `
      <div class="micro-item">
        <div class="micro-name">${m.name}</div>
        <div class="micro-val">${fmt(m.val, m.d)}<em>${m.unit}</em></div>
        <div class="micro-ref">${fmt(pct(m.val, m.ref))}% 每日參考</div>
      </div>`).join('');

    const p = pct(t.k, state.target);
    $('#target-pct').textContent = fmt(p) + '%';
    const fill = $('#target-fill');
    fill.style.width = Math.min(100, p) + '%';
    fill.style.background = p > 100 ? 'linear-gradient(90deg,#ff7a59,#e0393e)' : 'linear-gradient(90deg,#37c47a,#0f9d58)';
  }

  function donutSVG(split, centerText){
    const size = 148, r = 56, cx = size / 2, cy = size / 2;
    const C = 2 * Math.PI * r;
    const segs = [
      { v: split.p,  color:'#3E7BFA' },
      { v: split.cb, color:'#F2A63B' },
      { v: split.f,  color:'#FF5C7C' }
    ];
    let off = 0;
    const arcs = segs.map(s => {
      const len = C * (s.v / 100);
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="16"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"></circle>`;
      off += len;
      return el;
    }).join('');
    const total = split.p + split.cb + split.f;
    const empty = total < 0.5
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#eceae4" stroke-width="16"></circle>` : '';
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="三大營養素熱量比例">
      ${empty}${arcs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-k">${centerText}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-l">kcal</text>
    </svg>`;
  }

  /* ---------------- 每日目標 ---------------- */
  function bindTarget(){
    const input = $('#daily-target');
    input.addEventListener('change', () => {
      let v = parseInt(input.value, 10);
      if (!isFinite(v) || v < 800) v = 800;
      if (v > 5000) v = 5000;
      input.value = v;
      state.target = v;
      localStorage.setItem(LS_TARGET, String(v));
      renderTotals();
    });
  }

  /* ---------------- 搜尋 ---------------- */
  let activeCat = '全部';

  function renderQuickCats(){
    const wrap = $('#quick-cats');
    wrap.innerHTML = ['主食','肉類','蔬菜','水果','快餐','甜品','飲品'].map(c =>
      `<button class="chip" type="button" data-cat="${c}">${c}</button>`).join('');
    $$('.chip', wrap).forEach(b => b.addEventListener('click', () => openSearch('', b.dataset.cat)));
  }

  function openSearch(q, cat){
    activeCat = cat || '全部';
    $('#modal-search').hidden = false;
    $('#search-input').value = q || '';
    renderCatChips();
    renderSearchResults(q || '');
    setTimeout(() => $('#search-input').focus(), 50);
  }

  function renderCatChips(){
    const cats = ['全部'].concat(CATS);
    $('#cat-chips').innerHTML = cats.map(c =>
      `<button class="chip ${c === activeCat ? 'on' : ''}" type="button" data-cat="${c}">${c}</button>`).join('');
    $$('#cat-chips .chip').forEach(b => b.addEventListener('click', () => {
      activeCat = b.dataset.cat;
      renderCatChips();
      renderSearchResults($('#search-input').value);
    }));
  }

  function renderSearchResults(q){
    const query = (q || '').trim().toLowerCase();
    let list = FOODS;
    if (activeCat !== '全部') list = list.filter(f => f.c === activeCat);
    if (query){
      list = list.filter(f =>
        f.n.toLowerCase().includes(query) ||
        f.e.toLowerCase().includes(query) ||
        f.c.includes(query));
      list = list.slice().sort((a, b) => {
        const ai = a.n.toLowerCase().indexOf(query), bi = b.n.toLowerCase().indexOf(query);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.n.length - b.n.length;
      });
    }
    const box = $('#search-results');
    if (!list.length){
      box.innerHTML = `<li class="muted pad">找不到相符食物，試試其他關鍵字。</li>`;
      return;
    }
    box.innerHTML = list.slice(0, 80).map(f => `
      <li>
        <button class="s-item" type="button" data-add="${f.id}">
          <span class="cand-dot" style="background:${CAT_COLOR[f.c] || '#999'}"></span>
          <span class="s-name">${esc(f.n)}<small>${esc(f.e)}</small></span>
          <span class="s-kcal">${f.k} kcal<em>/100g</em></span>
        </button>
      </li>`).join('');
    $$('.s-item', box).forEach(b => b.addEventListener('click', () => {
      addItem(b.dataset.add, defaultGrams(b.dataset.add));
      closeModal($('#modal-search'));
    }));
  }

  /* ---------------- Modal ---------------- */
  function bindModals(){
    $('#btn-settings').addEventListener('click', () => {
      $('#api-base').value = state.settings.baseUrl || '';
      $('#api-model').value = state.settings.model || '';
      $('#api-key').value = state.settings.apiKey || '';
      try { $('#model-host').value = localStorage.getItem('foodcal.modelHost') || ''; } catch(e){}
      $('#modal-settings').hidden = false;
    });
    $('#btn-help').addEventListener('click', () => { $('#modal-help').hidden = false; });
    $('#btn-save-settings').addEventListener('click', () => {
      state.settings.baseUrl = $('#api-base').value.trim();
      state.settings.model = $('#api-model').value.trim();
      state.settings.apiKey = $('#api-key').value.trim();
      try {
        const host = $('#model-host').value.trim();
        if (host) localStorage.setItem('foodcal.modelHost', host);
        else localStorage.removeItem('foodcal.modelHost');
      } catch(e){}
      state.useApi = !!state.settings.apiKey;
      $('#use-api').checked = state.useApi;
      saveSettings();
      updateEngineNote();
      closeModal($('#modal-settings'));
      toast(state.useApi ? '已啟用 Vision API 辨識' : '已儲存設定');
    });
    $('#btn-clear-key').addEventListener('click', () => {
      state.settings.apiKey = '';
      state.useApi = false;
      $('#api-key').value = '';
      $('#use-api').checked = false;
      saveSettings();
      updateEngineNote();
      toast('已清除 API Key，改用離線模型');
    });

    $('#use-api').addEventListener('change', e => {
      if (e.target.checked && !state.settings.apiKey){
        e.target.checked = false;
        $('#modal-settings').hidden = false;
        toast('請先填入 API Key');
        return;
      }
      state.useApi = e.target.checked;
      saveSettings();
      updateEngineNote();
      if (state.lastFile && !state.busy) analyze(state.lastFile);
    });

    $('#search-input').addEventListener('input', e => renderSearchResults(e.target.value));

    $$('.modal').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
    });
    $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.closest('.modal'))));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') $$('.modal').forEach(m => { if (!m.hidden) closeModal(m); });
    });

    $('#btn-clear').addEventListener('click', () => {
      if (!state.items.length) return;
      if (!confirm('清空這一餐的所有項目？')) return;
      state.items = [];
      saveMeal(); renderMeal(); renderTotals();
    });
    $('#btn-copy').addEventListener('click', copySummary);
    $('#btn-print').addEventListener('click', () => window.print());
  }

  function updateEngineNote(){
    const note = $('#engine-note');
    if (state.useApi && state.settings.apiKey){
      const host = (state.settings.baseUrl || 'https://api.openai.com/v1').replace(/^https?:\/\//, '').split('/')[0];
      note.textContent = '使用 ' + host + ' 的 ' + (state.settings.model || 'gpt-4o-mini') + ' 辨識，相片會傳送到該服務商';
      note.classList.add('api');
    } else {
      note.textContent = '預設在瀏覽器離線辨識，相片不會上傳';
      note.classList.remove('api');
    }
  }

  /* ---------------- 匯出 ---------------- */
  async function copySummary(){
    if (!state.items.length){ toast('餐點是空的'); return; }
    const t = totalOf(state.items);
    const lines = ['【這餐營養估算】'];
    state.items.forEach(it => {
      const f = getFood(it.foodId);
      lines.push(`· ${f.n} ${it.grams}g — ${fmt(nutritionFor(f, it.grams).k)} kcal`);
    });
    lines.push('');
    lines.push(`總熱量：${fmt(t.k)} kcal（每日目標 ${fmt(state.target)} kcal 的 ${fmt(pct(t.k, state.target))}%）`);
    lines.push(`蛋白質 ${fmt(t.p,1)}g / 碳水 ${fmt(t.cb,1)}g / 脂肪 ${fmt(t.f,1)}g`);
    lines.push(`膳食纖維 ${fmt(t.fi,1)}g · 糖 ${fmt(t.su,1)}g · 鈉 ${fmt(t.na)}mg`);
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製營養摘要');
    } catch(e){
      prompt('複製以下內容：', text);
    }
  }

  /* ---------------- 小工具 ---------------- */
  let toastTimer = null;
  function toast(msg){
    let el = $('#toast');
    if (!el){
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function closeModal(m){ if (m) m.hidden = true; }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', init);
  window.__foodcal = state;
})();
