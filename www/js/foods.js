/* ===================================================================
   foods.js — renal food database + potassium/sodium thresholds.

   Ported concept from FoodYou (github.com/maksimowiczm/FoodYou): a food
   carries per-portion nutrient facts and the diary logs portions. Here
   the model is trimmed to what a haemodialysis patient at SKTI actually
   needs to watch — potassium (K), sodium (Na) and phosphorus (P) — and
   seeded with common Filipino foods so the numbers mean something at a
   Davao carinderia, not a US supermarket.

   IMPORTANT: every value below is an APPROXIMATE amount per the stated
   serving, from public food-composition tables (USDA / PhilFCT range).
   They are a teaching aid, NOT a lab result — the renal dietitian's
   advice always wins. The UI repeats this disclaimer to the patient.

   K/Na/P are in milligrams (mg) per one serving, kcal in kilocalories per
   one serving. `ml` (optional) is the fluid volume of a liquid/soupy
   food, so logging sabaw or buko here can also warn that it counts
   against the fluid allowance.
   =================================================================== */

/* Per-serving thresholds that flag a single food. Renal teaching commonly
   calls a food "high potassium" above ~200 mg per serving; sodium is
   judged more by the daily 2000 mg budget, so a single salty item trips
   higher. Phosphorus follows the same logic against the KDOQI 800-1000
   mg/day budget spread over ~3 meals. 'high' fires the alarm gate (K/Na
   only), 'mod' shows an amber badge on any of the three. */
export const K_HIGH  = 250, K_MOD  = 150;
export const NA_HIGH = 300, NA_MOD = 150;
export const PH_HIGH = 200, PH_MOD = 100;

const THRESH = {
  k:  { hi: K_HIGH,  md: K_MOD },
  na: { hi: NA_HIGH, md: NA_MOD },
  ph: { hi: PH_HIGH, md: PH_MOD }
};

/** 'ok' | 'mod' | 'high' for one mineral amount. kind: 'k' | 'na' | 'ph'. */
export function mineralLevel(mg, kind) {
  const { hi, md } = THRESH[kind] || THRESH.k;
  if (!Number.isFinite(mg)) return 'ok';
  if (mg >= hi) return 'high';
  if (mg >= md) return 'mod';
  return 'ok';
}

/** The worst of a food's K, Na and phosphorus levels — used to colour its row. */
export function foodLevel(food, servings = 1) {
  const rank = { ok: 0, mod: 1, high: 2 };
  return ['k', 'na', 'ph']
    .map(kind => mineralLevel(food[kind] * servings, kind))
    .reduce((worst, lvl) => rank[lvl] > rank[worst] ? lvl : worst, 'ok');
}

/* ---------- categories (order = display order) ---------- */
export const FOOD_CATS = [
  { id: 'fruit',     icon: 'bowl'    },
  { id: 'vegetable', icon: 'bowl'    },
  { id: 'meatfish',  icon: 'bowl'    },
  { id: 'ricegrain', icon: 'bowl'    },
  { id: 'processed', icon: 'bottle'  },
  { id: 'condiment', icon: 'bottle'  },
  { id: 'drink',     icon: 'cup'     },
  { id: 'dairyegg',  icon: 'cup'     }
];

/* ---------- the database ----------
   name: bilingual, English (Filipino) — kept as data, not an i18n key,
   so a food reads the same in every UI language.
   serving: human portion label the patient recognises.
   g: weight in grams of ONE serving — lets the portion sheet accept a
   kitchen-scale reading directly instead of only "servings".
   k / na / ph: mg per that serving.  kcal: kilocalories per that serving.
   protein / fiber: grams per that serving.  ml: fluid volume if liquid/soupy. */
export const FOOD_DB = [
  /* Fruit */
  { id: 'saging',   cat: 'fruit', name: 'Banana (Saging)',        serving: '1 medium',   g: 118, k: 420, na: 1,   ph: 26,  kcal: 105, protein: 1.3, fiber: 3.1 },
  { id: 'mangga',   cat: 'fruit', name: 'Mango (Mangga)',         serving: '1 cup',      g: 165, k: 277, na: 2,   ph: 18,  kcal: 99,  protein: 1.4, fiber: 2.6 },
  { id: 'papaya',   cat: 'fruit', name: 'Papaya',                 serving: '1 cup',      g: 145, k: 264, na: 12,  ph: 11,  kcal: 55,  protein: 0.5, fiber: 2.5 },
  { id: 'melon',    cat: 'fruit', name: 'Melon / Cantaloupe',     serving: '1 cup',      g: 160, k: 427, na: 26,  ph: 17,  kcal: 53,  protein: 1.3, fiber: 1.4 },
  { id: 'abokado',  cat: 'fruit', name: 'Avocado (Abokado)',      serving: '1/2 fruit',  g: 100, k: 345, na: 7,   ph: 26,  kcal: 160, protein: 2.0, fiber: 6.7 },
  { id: 'dalandan', cat: 'fruit', name: 'Orange (Dalandan)',      serving: '1 fruit',    g: 131, k: 237, na: 0,   ph: 18,  kcal: 62,  protein: 1.2, fiber: 3.1 },
  { id: 'pinya',    cat: 'fruit', name: 'Pineapple (Pinya)',      serving: '1 cup',      g: 165, k: 180, na: 2,   ph: 13,  kcal: 82,  protein: 0.9, fiber: 2.3 },
  { id: 'pakwan',   cat: 'fruit', name: 'Watermelon (Pakwan)',    serving: '1 cup',      g: 152, k: 170, na: 2,   ph: 17,  kcal: 46,  protein: 0.9, fiber: 0.6, ml: 150 },
  { id: 'mansanas', cat: 'fruit', name: 'Apple (Mansanas)',       serving: '1 medium',   g: 182, k: 195, na: 2,   ph: 20,  kcal: 95,  protein: 0.5, fiber: 4.4 },

  /* Vegetable */
  { id: 'kamote',   cat: 'vegetable', name: 'Sweet potato (Kamote)', serving: '1 medium', g: 130, k: 540, na: 72, ph: 62,  kcal: 112, protein: 2.0, fiber: 3.8 },
  { id: 'gabi',     cat: 'vegetable', name: 'Taro (Gabi)',           serving: '1 cup',    g: 132, k: 640, na: 20, ph: 100, kcal: 187, protein: 0.7, fiber: 6.7 },
  { id: 'patatas',  cat: 'vegetable', name: 'Potato (Patatas)',      serving: '1 medium', g: 173, k: 620, na: 13, ph: 60,  kcal: 161, protein: 4.3, fiber: 3.8 },
  { id: 'pechay',   cat: 'vegetable', name: 'Pechay (bok choy)',     serving: '1 cup ckd',g: 170, k: 630, na: 58, ph: 49,  kcal: 20,  protein: 2.7, fiber: 1.7 },
  { id: 'kalabasa', cat: 'vegetable', name: 'Squash (Kalabasa)',     serving: '1 cup',    g: 205, k: 340, na: 2,  ph: 30,  kcal: 80,  protein: 1.8, fiber: 2.9 },
  { id: 'kamatis',  cat: 'vegetable', name: 'Tomato (Kamatis)',      serving: '1 medium', g: 123, k: 292, na: 6,  ph: 30,  kcal: 22,  protein: 1.1, fiber: 1.5 },
  { id: 'malunggay',cat: 'vegetable', name: 'Malunggay leaves',      serving: '1 cup ckd',g: 60,  k: 340, na: 9,  ph: 70,  kcal: 35,  protein: 2.0, fiber: 2.0 },
  { id: 'kangkong', cat: 'vegetable', name: 'Kangkong (swamp cabbage)',serving:'1 cup ckd',g: 90, k: 300, na: 60, ph: 39, kcal: 30,  protein: 2.6, fiber: 2.0 },
  { id: 'sayote',   cat: 'vegetable', name: 'Chayote (Sayote)',      serving: '1 cup',    g: 132, k: 276, na: 2,  ph: 29,  kcal: 25,  protein: 0.8, fiber: 2.2 },
  { id: 'ampalaya', cat: 'vegetable', name: 'Bitter gourd (Ampalaya)',serving:'1 cup',    g: 124, k: 198, na: 6,  ph: 36,  kcal: 16,  protein: 1.0, fiber: 2.6 },
  { id: 'sitaw',    cat: 'vegetable', name: 'String beans (Sitaw)',  serving: '1 cup',    g: 110, k: 209, na: 4,  ph: 38,  kcal: 44,  protein: 2.4, fiber: 4.0 },
  { id: 'talong',   cat: 'vegetable', name: 'Eggplant (Talong)',     serving: '1 cup',    g: 82,  k: 188, na: 1,  ph: 20,  kcal: 35,  protein: 0.8, fiber: 2.5 },
  { id: 'repolyo',  cat: 'vegetable', name: 'Cabbage (Repolyo)',     serving: '1 cup',    g: 89,  k: 119, na: 13, ph: 18,  kcal: 22,  protein: 1.1, fiber: 2.2 },
  { id: 'karot',    cat: 'vegetable', name: 'Carrot (Karot)',        serving: '1 medium', g: 61,  k: 195, na: 42, ph: 26,  kcal: 25,  protein: 0.6, fiber: 1.7 },

  /* Meat & fish */
  { id: 'manok',    cat: 'meatfish', name: 'Chicken (Manok)',        serving: '100 g',    g: 100, k: 256, na: 82,  ph: 200, kcal: 239, protein: 27,  fiber: 0 },
  { id: 'baboy',    cat: 'meatfish', name: 'Pork (Baboy)',           serving: '100 g',    g: 100, k: 300, na: 60,  ph: 200, kcal: 242, protein: 27,  fiber: 0 },
  { id: 'bangus',   cat: 'meatfish', name: 'Milkfish (Bangus)',      serving: '100 g',    g: 100, k: 300, na: 72,  ph: 200, kcal: 190, protein: 20,  fiber: 0 },
  { id: 'itlog',    cat: 'meatfish', name: 'Egg (Itlog)',            serving: '1 large',  g: 50,  k: 63,  na: 62,  ph: 86,  kcal: 72,  protein: 6.3, fiber: 0 },
  { id: 'tuyo',     cat: 'meatfish', name: 'Dried fish (Tuyo/Daing)',serving: '1 piece',  g: 20,  k: 200, na: 900, ph: 200, kcal: 70,  protein: 8.0, fiber: 0 },

  /* Rice & grain */
  { id: 'kanin',    cat: 'ricegrain', name: 'Rice (Kanin)',          serving: '1 cup',    g: 158, k: 55,  na: 2,   ph: 68,  kcal: 205, protein: 4.3, fiber: 0.6 },
  { id: 'pandesal', cat: 'ricegrain', name: 'Pandesal',              serving: '1 piece',  g: 30,  k: 30,  na: 150, ph: 30,  kcal: 85,  protein: 2.5, fiber: 0.8 },
  { id: 'tinapay',  cat: 'ricegrain', name: 'White bread (Tinapay)', serving: '1 slice',  g: 25,  k: 37,  na: 144, ph: 25,  kcal: 75,  protein: 2.6, fiber: 0.8 },

  /* Processed / canned / snack */
  { id: 'noodles',  cat: 'processed', name: 'Instant noodles (Pancit Canton)', serving: '1 pack', g: 65, k: 130, na: 860, ph: 90,  kcal: 470, protein: 9.0,  fiber: 2.0 },
  { id: 'sardinas', cat: 'processed', name: 'Canned sardines (Sardinas)',      serving: '1/2 can', g: 60, k: 340, na: 400, ph: 250, kcal: 130, protein: 12.0, fiber: 0 },
  { id: 'cornbeef', cat: 'processed', name: 'Corned beef',                     serving: '1 serving', g: 100, k: 130, na: 700, ph: 120, kcal: 220, protein: 18.0, fiber: 0 },
  { id: 'hotdog',   cat: 'processed', name: 'Hotdog',                          serving: '1 piece', g: 45, k: 100, na: 350, ph: 80,  kcal: 150, protein: 5.0,  fiber: 0 },
  { id: 'chicharon',cat: 'processed', name: 'Chicharon',                       serving: '1 pack',  g: 30, k: 80,  na: 500, ph: 60,  kcal: 155, protein: 9.0,  fiber: 0 },
  { id: 'itlogmaalat',cat:'processed',name: 'Salted egg (Itlog na maalat)',    serving: '1 egg',   g: 70, k: 90,  na: 480, ph: 130, kcal: 90,  protein: 6.0,  fiber: 0 },

  /* Condiment (small volume, big sodium) */
  { id: 'toyo',     cat: 'condiment', name: 'Soy sauce (Toyo)',      serving: '1 tbsp',   g: 18, k: 40,  na: 900,  ph: 20, kcal: 9,  protein: 1.3, fiber: 0.1 },
  { id: 'patis',    cat: 'condiment', name: 'Fish sauce (Patis)',    serving: '1 tbsp',   g: 18, k: 50,  na: 1400, ph: 10, kcal: 5,  protein: 1.4, fiber: 0 },
  { id: 'bagoong',  cat: 'condiment', name: 'Shrimp paste (Bagoong)',serving: '1 tbsp',   g: 20, k: 40,  na: 1200, ph: 30, kcal: 30, protein: 3.0, fiber: 0 },
  { id: 'ketsup',   cat: 'condiment', name: 'Banana ketchup (Ketsup)',serving:'1 tbsp',   g: 17, k: 57,  na: 154,  ph: 8,  kcal: 15, protein: 0.1, fiber: 0.2 },

  /* Drink (also counts as fluid) — grams ≈ mL for these, water-like density */
  { id: 'sabaw',    cat: 'drink', name: 'Soup / broth (Sabaw)',      serving: '1 cup',    g: 240, k: 300, na: 800, ph: 40, kcal: 60,  protein: 3.0, fiber: 0.3, ml: 240 },
  { id: 'buko',     cat: 'drink', name: 'Coconut water (Buko juice)',serving: '1 cup',    g: 240, k: 600, na: 252, ph: 20, kcal: 46,  protein: 1.7, fiber: 2.6, ml: 240 },
  { id: 'softdrink',cat: 'drink', name: 'Cola softdrink',            serving: '1 can',    g: 330, k: 15,  na: 15,  ph: 55, kcal: 140, protein: 0,   fiber: 0,   ml: 330 },
  { id: 'kape3in1', cat: 'drink', name: '3-in-1 coffee (Kape)',      serving: '1 sachet', g: 150, k: 90,  na: 60,  ph: 60, kcal: 110, protein: 1.0, fiber: 0,   ml: 150 },

  /* Dairy & egg */
  { id: 'gatas',    cat: 'dairyegg', name: 'Milk (Gatas)',           serving: '1 cup',    g: 244, k: 366, na: 107, ph: 247, kcal: 149, protein: 8.0, fiber: 0, ml: 240 },
  { id: 'keso',     cat: 'dairyegg', name: 'Cheese (Keso)',          serving: '1 slice',  g: 28,  k: 28,  na: 174, ph: 130, kcal: 70,  protein: 4.4, fiber: 0 }
];

const BY_ID = Object.fromEntries(FOOD_DB.map(f => [f.id, f]));
export function findFood(id) { return BY_ID[id] || null; }
