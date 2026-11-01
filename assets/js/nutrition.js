/* 營養計算核心 */
const FOOD_MAP = new Map(FOODS.map(f => [f.id, f]));

/* 一般成人每日建議攝取量（以 2000 kcal 為基準，僅供參考） */
const DAILY_REF = { k:2000, p:75, cb:275, f:65, fi:28, su:50, na:2000 };

/* 三大營養素熱量係數 */
const KCAL_PER_G = { p:4, cb:4, f:9 };

function getFood(id){ return FOOD_MAP.get(id) || null; }

/** 以克數計算某食物的營養 */
function nutritionFor(food, grams){
  const r = grams / 100;
  return {
    k:  food.k  * r,
    p:  food.p  * r,
    cb: food.cb * r,
    f:  food.f  * r,
    fi: food.fi * r,
    su: food.su * r,
    na: food.na * r
  };
}

/** 加總多個項目 [{foodId, grams}] */
function totalOf(items){
  const t = { k:0, p:0, cb:0, f:0, fi:0, su:0, na:0 };
  items.forEach(it => {
    const food = getFood(it.foodId);
    if (!food) return;
    const v = nutritionFor(food, it.grams);
    for (const key in t) t[key] += v[key];
  });
  return t;
}

/** 由蛋白質/碳水/脂肪反推的熱量（用於核對與圖表比例） */
function macroKcal(t){
  return {
    p: t.p * KCAL_PER_G.p,
    cb: t.cb * KCAL_PER_G.cb,
    f: t.f * KCAL_PER_G.f
  };
}

function pct(part, whole){ return whole > 0 ? (part / whole) * 100 : 0; }

/** 依體重估算每日熱量需求（Mifflin-St Jeor，活動係數中等） */
function dailyTarget(weightKg, heightCm, age, sex, activity){
  if (!weightKg || !heightCm || !age) return 2000;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'female' ? -161 : 5);
  const factor = { low:1.2, light:1.375, medium:1.55, high:1.725 }[activity || 'medium'];
  return Math.round(bmr * factor);
}

/** 單項目的三大營養素熱量佔比（用於判斷食物組成） */
function macroSplitOf(t){
  const mk = macroKcal(t);
  const sum = mk.p + mk.cb + mk.f;
  if (sum <= 0) return { p:0, cb:0, f:0 };
  return { p: mk.p / sum * 100, cb: mk.cb / sum * 100, f: mk.f / sum * 100 };
}

function fmt(n, d){
  if (!isFinite(n)) return '0';
  const x = Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0);
  return x.toLocaleString('en-US', { maximumFractionDigits: d || 0 });
}
