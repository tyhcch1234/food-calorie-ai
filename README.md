# 食物卡路里辨識 · Food Calorie AI

**線上版：<https://tyhcch1234.github.io/food-calorie-ai/>**

上載一張食物相片，即時估算卡路里、蛋白質、碳水化合物、脂肪、膳食纖維、糖與鈉，並顯示份量。
純靜態網頁（HTML + CSS + 原生 JS），沒有後端、沒有 build step，可直接放在 GitHub Pages。

## 功能

- **相片上載**：拖放 / 選擇檔案 / 手機拍照 / Ctrl+V 貼上，或用內建示範相片（`demo/sample-fried-rice.jpg`）先試
- **食物辨識**
  - 預設：Transformers.js + CLIP zero-shot 模型，**完全在瀏覽器內執行**，相片不會離開裝置
  - 選用：OpenAI 相容的 Vision API（自備 Key），可辨識多種食物並估算份量
- **份量調整**：克數滑桿、數字輸入，以及碗 / 隻 / 片 / 杯等常用份量快捷鍵
- **營養計算**：總熱量、三大營養素克數與熱量佔比（甜甜圈圖）、纖維 / 糖 / 鈉、對比每日目標
- **餐點清單**：可累加多項食物、逐項增刪、自動儲存在瀏覽器
- **匯出**：複製營養摘要文字、列印或存成 PDF
- **資料庫**：130+ 項常見食物與菜式（含港式、中式、西式、手搖飲品等），每 100 克營養值

## 使用

1. 上載食物相片。
2. 頂部「辨識結果」會列出候選食物與信心度，按一下即加入；不確定就用「＋ 手動搜尋食物」自己揀。
3. 在右邊拉動份量滑桿，卡路里與營養素即時更新。
4. 需要更準確的多食物辨識 → 右上「設定」填入 API Key（Key 只存在你裝置的 localStorage）。

## 本機執行

```bash
# 任何靜態伺服器都可以
python3 -m http.server 8080
# 開啟 http://localhost:8080
```

> 直接雙擊 `index.html`（file://）也可以瀏覽，但離線模型與 API 請求建議用 http:// 執行。

## 部署

已針對 GitHub Pages 最佳化：把整個資料夾推到 repo 的 default branch，於 Settings → Pages 選 `main` / root 即可。
`.nojekyll` 已包含，避免 Jekyll 處理資產。

## 技術說明

| 項目 | 說明 |
|---|---|
| 離線辨識 | `@xenova/transformers` v2 + `Xenova/clip-vit-base-patch32`（CLIP zero-shot，quantized） |
| 候選標籤 | 130+ 條英文提示詞（例如 `a plate of fried rice with egg and vegetables`），對應到食物資料庫 |
| 首次載入 | 需下載約 300MB 模型權重（文字 + 視覺），之後由 Browser Cache 快取 |
| 模型來源 | 預設 `huggingface.co`；如所在地區被阻，可在「設定 → 模型來源」填鏡像（例如 `https://hf-mirror.com/`）或自架，亦可用 `?modelHost=` 參數指定 |
| 推理執行 | ONNX Runtime Web（wasm、單執行緒）在 Web Worker 內執行，避免主執行緒凍結 |
| API 模式 | `POST {baseUrl}/chat/completions`，含 `image_url`，要求回傳嚴格 JSON（食物、克數、信心值） |
| 名稱比對 | 完全相符 → 包含關係（取最長匹配）→ 中文字元重疊度 |
| 資料儲存 | 全部在 localStorage（設定、餐點、每日目標） |

## 實測（離線模型，127 個候選標籤）

| 測試相片 | top-1 結果 | 信心度 | 第二名 |
|---|---|---|---|
| 蛋炒飯 | 揚州炒飯 `fried_rice` | 35.8% | 即食麵 8.7% |
| 芝士漢堡 | 芝士漢堡 `cheeseburger` | 62.0% | 漢堡包 20.8% |

CLIP zero-shot 對「單一主食」相當準，但信心度通常落在 30–65% 區間，因此介面會同時列出前 5 名候選並標示「很可能 / 可能 / 不確定」，讓你一秒糾正。

## 準確度與限制

- **份量只能估算**：單張相片沒有尺寸參照，預設用該食物的常見份量，請自行按實際情況調整（這是最大誤差來源）。
- **離線模型**：CLIP zero-shot 對常見菜式／食材有一定辨識力，但混合菜式（例如碟頭飯）、遮擋、暗光會失準；信心度低時請手動確認。
- **只能認出單一主體**：離線模型回傳一個最可能的食物（附前 5 名候選），多碟菜建議分別上載或用搜尋加入；需要一次辨識多項食物請用 Vision API 模式。
- **營養數值**：每 100 克參考值，取自 USDA FoodData Central 與香港食物安全中心常見數據，實際含量隨食材、煮法、品牌而異。
- 本工具只供估算與記錄，不用作醫療、營養治療或飲食處方。

## 專案結構

```
index.html
assets/css/style.css
assets/js/foods.js        # 食物資料庫 + CLIP 候選標籤
assets/js/nutrition.js    # 營養計算
assets/js/recognizer.js   # 離線模型 / Vision API / 名稱比對
assets/js/app.js          # 介面邏輯
```

## 授權

程式碼 MIT。食物營養數值為事實性資料，模型權重依 `Xenova/clip-vit-base-patch32`（MIT）授權於使用時從 Hugging Face CDN 載入。
