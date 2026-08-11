/* ===================================================================
   store.js — all state lives on the device. No server, no account.
   localStorage, namespaced and versioned so a future schema change
   can migrate instead of wiping a patient's history.
   =================================================================== */

import { findFood } from './foods.js';

const NS = 'skti.v1.';
const KEYS = {
  profile:     NS + 'profile',
  weights:     NS + 'weights',
  intake:      NS + 'intake',
  sessions:    NS + 'sessions',
  medications: NS + 'medications',
  medLogs:     NS + 'med_logs',
  checklists:  NS + 'checklists',
  hdBp:        NS + 'hd_bp',
  foodLogs:    NS + 'food_logs',
  labLogs:     NS + 'lab_logs'
};

const DEFAULT_PROFILE = {
  name: '',
  bookletNo: '',
  doctorName: '',
  nursePhone: '',
  emergencyPhone: '',
  dryWeightKg: null,      // set by the SKTI nephrologist
  allowanceMl: 1000,      // set by the SKTI nurse
  idwgLimitKg: 2.0,       // typical starting limit; editable

  // Daily diet budgets the renal dietitian sets. Defaults follow the
  // KDOQI 2020 Clinical Practice Guideline for Nutrition in CKD, the
  // haemodialysis columns specifically:
  //   potassium   2,000-3,000 mg/day  (HD; unrestricted on PD)
  //   sodium      <2,300 mg/day
  //   phosphorus  800-1,000 mg/day
  //   energy      25-35 kcal/kg dry (IBW) weight/day
  //   protein     1.0-1.2 g/kg dry (IBW) weight/day
  //   fiber       25-34 g/day
  // kcal/protein additionally scale off dryWeightKg via
  // recommendedKcalRange()/recommendedProteinRange() below, shown to the
  // patient as a suggestion in Settings — the stored number here is
  // always what the dietitian actually set (or this flat starting point
  // before they have).
  potassiumLimitMg: 2000,
  sodiumLimitMg: 2300,
  phosphorusLimitMg: 900,
  kcalGoal: 1800,
  proteinGoalG: 60,
  fiberGoalG: 30,

  // When true (the default), potassium/phosphorus/protein goals actually
  // USED by the app (bands, alarms, the summary card) are computed live
  // from the most recent lab draw via effectivePotassiumLimitMg() etc.
  // below, not read off the flat fields above. Those flat fields become
  // the fallback for when there's no lab yet, and the value the nurse
  // falls back to if they switch auto off. Sodium/fiber/kcal are
  // deliberately NOT included — sodium restriction is driven by fluid
  // overload and blood pressure, not serum sodium (which mostly reflects
  // water balance in a dialysis patient); fiber has no serum correlate;
  // kcal only scales with dry weight, already handled separately.
  autoGoalsFromLabs: true,

  // Most recent lab draw — entered by the nurse/dietitian, not the
  // patient. Drives recommendedPotassiumRangeFromLab() /
  // recommendedPhosphorusRangeFromLab() below: KDOQI ties the dietary K
  // restriction specifically to "when serum potassium is elevated", so a
  // normal lab justifies a looser goal, not the same flat number for
  // everyone. labNa/labAlbumin are informational only — serum sodium in
  // a dialysis patient mostly reflects fluid balance, not dietary sodium
  // intake, so it does NOT drive the sodium goal; albumin is a
  // malnutrition marker but confounded by inflammation, so it's shown,
  // not used to compute a number.
  // Legacy flat lab fields — kept here ONLY for backward-compatible
  // restore/migration. The canonical store is now KEYS.labLogs.
  // New installs will never write these; importAll migrates them.
  labK: null,
  labPhos: null,
  labNa: null,
  labAlbumin: null,
  labDate: null,

  schedule: 'MWF',        // 'MWF' | 'TTS' | 'CUSTOM'
  customDays: [1, 3, 5],  // Mon, Wed, Fri
  shiftName: '1st Shift',
  sessionTime: '06:00',   // chair time, used for calendar events
  stationNo: '',
  philHealthTarget: 156,
  philHealthUsed: 0,
  weighTime: '06:30',     // daily weigh-in reminder
  lang: 'en',            // default language is English
  theme: 'auto',          // 'auto' | 'light' | 'dark'
  setupDone: false,

  // Home scale minus SKTI scale, in kg.
  scaleOffsetKg: 0,
  scaleCalibratedAt: null
};

/* ---------- low level ---------- */

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    // Corrupt entry: don't take the whole app down with it.
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;   // quota or private-mode; caller surfaces this
  }
}

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => fn()); }

/* ---------- dates ---------- */

/** Local calendar day, not UTC — a 7am weigh-in must land on today. */
export function dayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysBetween(aKey, bKey) {
  const a = new Date(aKey + 'T00:00:00');
  const b = new Date(bKey + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- profile ---------- */

export function getProfile() {
  return { ...DEFAULT_PROFILE, ...read(KEYS.profile, {}) };
}

export function saveProfile(patch) {
  const next = { ...getProfile(), ...patch };
  write(KEYS.profile, next);
  emit();
  return next;
}

/* ---------- weights ---------- */

export function getWeights() {
  return read(KEYS.weights, []).sort((a, b) => b.ts - a.ts);
}

/** One weight per calendar day — a second entry replaces the first. */
export function logWeight(kg, when = new Date()) {
  const key = dayKey(when);
  const list = read(KEYS.weights, []).filter(w => w.day !== key);
  list.push({ id: uid(), day: key, ts: when.getTime(), kg: Number(kg) });
  write(KEYS.weights, list);
  emit();
}

export function deleteWeight(id) {
  write(KEYS.weights, read(KEYS.weights, []).filter(w => w.id !== id));
  emit();
}

export function todayWeight() {
  return getWeights().find(w => w.day === dayKey()) || null;
}

/* ---------- fluid intake ---------- */

export function getIntake() {
  return read(KEYS.intake, []).sort((a, b) => b.ts - a.ts);
}

export function logIntake(ml, labelKey) {
  const list = read(KEYS.intake, []);
  const entry = { id: uid(), day: dayKey(), ts: Date.now(), ml: Number(ml), labelKey };
  list.push(entry);
  write(KEYS.intake, list);
  emit();
  return entry;
}

export function deleteIntake(id) {
  write(KEYS.intake, read(KEYS.intake, []).filter(i => i.id !== id));
  emit();
}

/** Undo support: put a deleted entry back exactly as it was. */
export function restoreIntake(entry) {
  const list = read(KEYS.intake, []);
  if (!list.some(i => i.id === entry.id)) list.push(entry);
  write(KEYS.intake, list);
  emit();
}

export function todayIntake() {
  const key = dayKey();
  return getIntake().filter(i => i.day === key);
}

export function todayIntakeMl() {
  return todayIntake().reduce((sum, i) => sum + i.ml, 0);
}

/* ---------- food log (potassium / sodium tracker) ----------
   Ported concept from FoodYou: a logged portion snapshots the food's
   mineral load at log time (foods.js values can change between app
   versions; a saved diary entry must not silently rewrite history).
   servings is a multiplier on the food's per-serving K/Na/P. */

export function getFoodLogs() {
  return read(KEYS.foodLogs, []).sort((a, b) => b.ts - a.ts);
}

export const MEALS = ['breakfast', 'lunch', 'dinner'];

/** Clock-based default when the patient doesn't pick a meal explicitly. */
export function inferMeal(when = new Date()) {
  const h = when.getHours();
  if (h < 11) return 'breakfast';
  if (h < 17) return 'lunch';
  return 'dinner';
}

export function logFood(foodId, servings = 1, when = new Date(), meal = null) {
  const f = findFood(foodId);
  if (!f) return null;
  const s = Number(servings) || 1;
  const list = read(KEYS.foodLogs, []);
  const entry = {
    id: uid(), day: dayKey(when), ts: when.getTime(),
    meal: MEALS.includes(meal) ? meal : inferMeal(when),
    foodId: f.id, name: f.name, serving: f.serving, servings: s,
    kMg:  Math.round(f.k  * s),
    naMg: Math.round(f.na * s),
    phMg: Math.round((f.ph || 0) * s),
    kcal: Math.round((f.kcal || 0) * s),
    proteinG: Math.round((f.protein || 0) * s * 10) / 10,
    fiberG:   Math.round((f.fiber   || 0) * s * 10) / 10,
    ml:   Math.round((f.ml || 0) * s)   // fluid volume, if a liquid/soupy food
  };
  list.push(entry);
  write(KEYS.foodLogs, list);
  emit();
  return entry;
}

export function deleteFood(id) {
  write(KEYS.foodLogs, read(KEYS.foodLogs, []).filter(e => e.id !== id));
  emit();
}

/** Undo support, matching restoreIntake. */
export function restoreFood(entry) {
  const list = read(KEYS.foodLogs, []);
  if (!list.some(e => e.id === entry.id)) list.push(entry);
  write(KEYS.foodLogs, list);
  emit();
}

export function todayFood() {
  const key = dayKey();
  return getFoodLogs().filter(e => e.day === key);
}

/** Today's entries split into the three meal tables the Food tab shows. */
export function todayFoodByMeal() {
  const all = todayFood();
  return Object.fromEntries(MEALS.map(m => [m, all.filter(e => e.meal === m)]));
}

/** Running daily totals for the mineral meters. */
export function todayFoodTotals() {
  return todayFood().reduce((acc, e) => {
    acc.k       += e.kMg      || 0;
    acc.na      += e.naMg     || 0;
    acc.ph      += e.phMg     || 0;
    acc.kcal    += e.kcal     || 0;
    acc.protein += e.proteinG || 0;
    acc.fiber   += e.fiberG   || 0;
    acc.ml      += e.ml       || 0;
    return acc;
  }, { k: 0, na: 0, ph: 0, kcal: 0, protein: 0, fiber: 0, ml: 0 });
}

/** 'ok' below 70% of the limit, 'warn' up to it, 'danger' past it —
    same three-band grammar the fluid/IDWG status uses. */
export function mineralBand(totalMg, limitMg) {
  if (!limitMg) return null;
  if (totalMg <= limitMg * 0.7) return 'ok';
  if (totalMg <= limitMg) return 'warn';
  return 'danger';
}

export function potassiumBand() {
  return mineralBand(todayFoodTotals().k, effectivePotassiumLimitMg());
}
export function sodiumBand() {
  return mineralBand(todayFoodTotals().na, getProfile().sodiumLimitMg);
}
export function kcalBand() {
  return mineralBand(todayFoodTotals().kcal, getProfile().kcalGoal);
}
export function phosphorusBand() {
  return mineralBand(todayFoodTotals().ph, effectivePhosphorusLimitMg());
}

/** KDOQI protein and fiber targets are daily MINIMUMS, not ceilings —
    the opposite polarity from K/Na/phosphorus/kcal above. 'ok' once the
    goal is met, 'warn' past halfway, 'danger' well short (that's the
    protein-energy-wasting risk zone, so "danger" still means "act on
    this", just in the opposite direction from the mineral bands). */
export function goalFloorBand(total, goal) {
  if (!goal) return null;
  if (total >= goal) return 'ok';
  if (total >= goal * 0.5) return 'warn';
  return 'danger';
}
export function proteinBand() {
  return goalFloorBand(todayFoodTotals().protein, effectiveProteinGoalG());
}
export function fiberBand() {
  return goalFloorBand(todayFoodTotals().fiber, getProfile().fiberGoalG);
}

/** KDOQI's energy and protein targets are per kg of dry (IBW) weight,
    unlike the flat mg/day mineral budgets — shown in Settings as a
    suggestion once a dry weight is on file, so the nurse/dietitian can
    see the recommended range before typing in the number they actually
    want. Returns null with no dry weight yet. */
export function recommendedKcalRange(profile = getProfile()) {
  if (!profile.dryWeightKg) return null;
  return { low: Math.round(profile.dryWeightKg * 25), high: Math.round(profile.dryWeightKg * 35) };
}
export function recommendedProteinRange(profile = getProfile()) {
  if (!profile.dryWeightKg) return null;
  return { low: Math.round(profile.dryWeightKg * 1.0), high: Math.round(profile.dryWeightKg * 1.2) };
}

/* ---------- lab-based goal suggestions ----------
   KDOQI's flat mg/day mineral budgets are a starting point for a patient
   with no lab history yet; once a lab is on file the actual restriction
   should track it — a normal serum level does not need the same tight
   number as a truly elevated one. Both functions return null with no
   lab value on file, {low, high, flag} otherwise. flag is 'high' |
   'normal' | 'low', purely descriptive — it drives copy/colour in the
   UI, the numbers are what actually get suggested. */

const NORMAL_SERUM_K   = { low: 3.5, high: 5.5 };  // mEq/L
const NORMAL_SERUM_PHOS = { low: 2.5, high: 5.5 }; // mg/dL

export function recommendedPotassiumRangeFromLab(profile = getProfile()) {
  // Read from the lab log (new) — fall back to profile fields (legacy).
  const latest = latestLab();
  const lab = (latest && latest.k != null) ? latest.k : profile.labK;
  if (!Number.isFinite(lab)) return null;
  if (lab > NORMAL_SERUM_K.high) return { low: 1500, high: 2000, flag: 'high' };
  if (lab < NORMAL_SERUM_K.low)  return { low: 3000, high: 3500, flag: 'low' };
  return { low: 2000, high: 3000, flag: 'normal' };
}

export function recommendedPhosphorusRangeFromLab(profile = getProfile()) {
  // Read from the lab log (new) — fall back to profile fields (legacy).
  const latest = latestLab();
  const lab = (latest && latest.phos != null) ? latest.phos : profile.labPhos;
  if (!Number.isFinite(lab)) return null;
  if (lab > NORMAL_SERUM_PHOS.high) return { low: 600, high: 800, flag: 'high' };
  if (lab < NORMAL_SERUM_PHOS.low)  return { low: 1000, high: 1200, flag: 'low' };
  return { low: 800, high: 1000, flag: 'normal' };
}

/* ---------- effective goals — the numbers actually enforced ----------
   With autoGoalsFromLabs on (the default) these override the flat
   profile fields whenever a lab-based number is available, so the band
   colours, the alarm gate and the summary card all track the patient's
   real chemistry instead of a number that was typed in once and never
   revisited. The flat field is the fallback for "no lab yet" and for
   "auto is switched off" — never silently overwritten by this. */

/** Midpoint of a {low, high} suggestion, rounded to the nearest 50 mg —
    same rounding the old manual "Apply" button used. */
const midpoint50 = r => Math.round((r.low + r.high) / 2 / 50) * 50;

export function effectivePotassiumLimitMg(profile = getProfile()) {
  if (profile.autoGoalsFromLabs) {
    const rec = recommendedPotassiumRangeFromLab(profile);
    if (rec) return midpoint50(rec);
  }
  return profile.potassiumLimitMg;
}

export function effectivePhosphorusLimitMg(profile = getProfile()) {
  if (profile.autoGoalsFromLabs) {
    const rec = recommendedPhosphorusRangeFromLab(profile);
    if (rec) return midpoint50(rec);
  }
  return profile.phosphorusLimitMg;
}

/** Protein has no direct lab threshold the way K/phosphorus do — KDOQI's
    1.0-1.2 g/kg dry weight range is a spread, not a lab-triggered switch.
    What DOES move within that spread is serum albumin: a low albumin is
    a malnutrition marker, so it pushes the target to the top of the
    range (1.2) instead of the usual midpoint (1.1). Needs a dry weight
    on file either way — falls back to the flat manual number without
    one, same as recommendedProteinRange(). */
export function effectiveProteinGoalG(profile = getProfile()) {
  if (profile.autoGoalsFromLabs && profile.dryWeightKg) {
    const albumin = latestLab()?.albumin;
    const factor = Number.isFinite(albumin) && albumin < LAB_RANGES.albumin.low ? 1.2 : 1.1;
    return Math.round(profile.dryWeightKg * factor);
  }
  return profile.proteinGoalG;
}

/* ---------- lab logs ----------
   Each blood draw is stored as a separate dated record, not overwriting
   a single set of profile fields. This lets the app show trends over
   multiple months and lets the nurse compare consecutive results.

   Fields: k (mEq/L), phos (mg/dL), na (mEq/L), albumin (g/dL),
           hgb (g/dL), bun (mg/dL), creatinine (mg/dL),
           bicarbonate (mEq/L), calcium (mg/dL), uricAcid (mg/dL),
           note (free text). All optional except day/ts. */

export function getLabLogs() {
  return read(KEYS.labLogs, []).sort((a, b) => b.ts - a.ts);
}

export function latestLab() {
  return getLabLogs()[0] || null;
}

export function logLab(data, when = new Date()) {
  // Migrate any legacy profile lab fields on first save if no logs exist yet.
  _migrateLabsIfNeeded();
  const list = read(KEYS.labLogs, []);
  const entry = {
    id: uid(),
    day: data.day || dayKey(when),
    ts: when.getTime(),
    k:           data.k           != null ? Number(data.k)           : null,
    phos:        data.phos        != null ? Number(data.phos)        : null,
    na:          data.na          != null ? Number(data.na)          : null,
    albumin:     data.albumin     != null ? Number(data.albumin)     : null,
    hgb:         data.hgb         != null ? Number(data.hgb)         : null,
    bun:         data.bun         != null ? Number(data.bun)         : null,
    creatinine:  data.creatinine  != null ? Number(data.creatinine)  : null,
    bicarbonate: data.bicarbonate != null ? Number(data.bicarbonate) : null,
    calcium:     data.calcium     != null ? Number(data.calcium)     : null,
    uricAcid:    data.uricAcid    != null ? Number(data.uricAcid)    : null,
    note:        data.note ? String(data.note).slice(0, 300) : ''
  };
  list.push(entry);
  write(KEYS.labLogs, list);
  emit();
  return entry;
}

export function deleteLab(id) {
  write(KEYS.labLogs, read(KEYS.labLogs, []).filter(e => e.id !== id));
  emit();
}

/* Migrate legacy single-set profile lab fields into the new log on first
   access. Runs silently at most once — after migration the profile fields
   are nulled out so they never migrate again. */
function _migrateLabsIfNeeded() {
  const existing = read(KEYS.labLogs, []);
  if (existing.length > 0) return;   // already have log entries
  const p = getProfile();
  const hasLegacy = p.labK != null || p.labPhos != null || p.labNa != null || p.labAlbumin != null;
  if (!hasLegacy) return;
  const when = p.labDate ? new Date(p.labDate + 'T00:00:00') : new Date();
  const entry = {
    id: uid(),
    day: p.labDate || dayKey(when),
    ts:  when.getTime(),
    k:        p.labK,
    phos:     p.labPhos,
    na:       p.labNa,
    albumin:  p.labAlbumin,
    hgb: null, bun: null, creatinine: null,
    bicarbonate: null, calcium: null, uricAcid: null,
    note: ''
  };
  write(KEYS.labLogs, [entry]);
  // Clear legacy fields from profile so we never migrate again.
  saveProfile({ labK: null, labPhos: null, labNa: null, labAlbumin: null, labDate: null });
}

/* Reference ranges used for colour-coding in the UI (KDOQI / standard HD). */
export const LAB_RANGES = {
  k:           { low: 3.5,  high: 5.5,  unit: 'mEq/L' },
  phos:        { low: 2.5,  high: 5.5,  unit: 'mg/dL' },
  na:          { low: 135,  high: 145,  unit: 'mEq/L' },
  albumin:     { low: 3.5,  high: null, unit: 'g/dL'  },   // floor only
  hgb:         { low: 10,   high: 13,   unit: 'g/dL'  },
  bun:         { low: null, high: 100,  unit: 'mg/dL' },   // ceiling only (pre-HD)
  creatinine:  { low: null, high: null, unit: 'mg/dL' },   // informational
  bicarbonate: { low: 18,   high: 24,   unit: 'mEq/L' },
  calcium:     { low: 8.4,  high: 10.2, unit: 'mg/dL' },
  uricAcid:    { low: null, high: 8,    unit: 'mg/dL' }    // ceiling only
};

/** 'normal' | 'low' | 'high' | null (if no range defined for this test). */
export function labFlag(value, key) {
  if (!Number.isFinite(value)) return null;
  const r = LAB_RANGES[key];
  if (!r) return null;
  if (r.low  != null && value < r.low)  return 'low';
  if (r.high != null && value > r.high) return 'high';
  return 'normal';
}

/* ---------- dialysis sessions ---------- */

export function getSessions() {
  return read(KEYS.sessions, []).sort((a, b) => b.ts - a.ts);
}

export function logSession(data, when = new Date()) {
  const list = read(KEYS.sessions, []);
  list.push({
    id: uid(),
    day: dayKey(when),
    ts: when.getTime(),
    preKg:  data.preKg  ?? null,
    postKg: Number(data.postKg),
    ufL:    data.ufL    ?? null,
    bpSys:  data.bpSys  ?? null,
    bpDia:  data.bpDia  ?? null
  });
  write(KEYS.sessions, list);
  emit();
}

export function deleteSession(id) {
  write(KEYS.sessions, read(KEYS.sessions, []).filter(s => s.id !== id));
  emit();
}

export function lastSession() {
  return getSessions()[0] || null;
}

/* ===================================================================
   Derived values — the actual clinical maths.

   IDWG (interdialytic weight gain) = today's weight − weight recorded
   at the END of the last dialysis. That post-session weight is the
   only honest baseline, which is why the session log exists at all.

   The limit stretches on a long gap: on MWF, Friday→Monday is two
   nights, not one, so the same daily gain adds up to more. The app
   scales the limit by the real number of days since the last session
   rather than pretending every gap is identical.
   =================================================================== */

/* The limit a nurse quotes is for the NORMAL gap between that patient's
   sessions, and on both MWF and TTS that gap is two days — Mon to Wed,
   Wed to Fri. A one-day gap barely happens. Scaling is therefore
   anchored at two days: the quoted number is used as-is on a normal
   interval, and only the long weekend gap (Fri to Mon) allows more.
   Capped at three days so a long lapse in treatment cannot quietly
   licence an unlimited gain. */
const NORMAL_GAP_DAYS = 2;
const MAX_SCALED_GAP = 3;

export function gapDays() {
  const s = lastSession();
  if (!s) return null;
  return Math.max(1, daysBetween(s.day, dayKey()));
}

export function effectiveLimitKg() {
  const p = getProfile();
  const base = p.idwgLimitKg || 2.0;
  const gap = gapDays();
  if (gap == null) return base;
  const scaled = Math.min(Math.max(gap, 1), MAX_SCALED_GAP);
  return +(base * scaled / NORMAL_GAP_DAYS).toFixed(2);
}

/**
 * Calibrate the home scale against SKTI's.
 * Both readings must be of the same body on the same evening — the patient
 * weighs at home the night of a dialysis, and we compare against the post
 * weight recorded at the centre.
 */
export function setScaleOffset(homeKg, clinicKg) {
  const offset = +(Number(homeKg) - Number(clinicKg)).toFixed(2);
  return saveProfile({ scaleOffsetKg: offset, scaleCalibratedAt: Date.now() });
}

export function isCalibrated() {
  return getProfile().scaleCalibratedAt != null;
}

export function idwgKg() {
  const s = lastSession();
  const w = todayWeight();
  if (!s || !w) return null;
  const offset = getProfile().scaleOffsetKg || 0;
  return +((w.kg - offset) - s.postKg).toFixed(2);
}

/** 'ok' below 70% of the limit, 'warn' up to the limit, 'danger' past it. */
export function band() {
  const gain = idwgKg();
  if (gain == null) return null;
  const limit = effectiveLimitKg();
  if (gain <= limit * 0.7) return 'ok';
  if (gain <= limit) return 'warn';
  return 'danger';
}

export function fluidLeftMl() {
  const p = getProfile();
  if (!p.allowanceMl) return null;
  return p.allowanceMl - todayIntakeMl();
}

/** A "glass" is 250 mL throughout the app — the number patients think in. */
export const GLASS_ML = 250;

export function glassesLeft() {
  const left = fluidLeftMl();
  if (left == null) return null;
  return Math.max(0, Math.floor(left / GLASS_ML));
}

/* ---------- schedule ---------- */

const SCHEDULE_DOW = { MWF: [1, 3, 5], TTS: [2, 4, 6] };

/** Day-of-week numbers (0=Sun) the patient dialyzes on, per their schedule. */
export function scheduleDays() {
  const p = getProfile();
  if (p.schedule === 'CUSTOM' && Array.isArray(p.customDays)) return p.customDays;
  return SCHEDULE_DOW[p.schedule] || SCHEDULE_DOW.MWF;
}

export function nextSessionDate() {
  const days = scheduleDays();
  const now = new Date();
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    if (days.includes(d.getDay())) {
      // Today counts only if no session has been recorded for today yet.
      if (i === 0 && lastSession()?.day === dayKey()) continue;
      return d;
    }
  }
  return null;
}

/* ---------- medications ---------- */

const DEFAULT_MEDS = [
  {
    id: 'med-1',
    name: 'Calcium Carbonate (Phosphate Binder)',
    dose: '500mg (1 tablet)',
    timing: 'meals', // 'morning' | 'afternoon' | 'evening' | 'bedtime' | 'meals'
    notes: 'Take with first bite of meal to bind phosphate.',
    holdOnDialysis: false,
    active: true
  },
  {
    id: 'med-2',
    name: 'Amlodipine (Blood Pressure)',
    dose: '5mg (1 tablet)',
    timing: 'morning',
    notes: 'Blood pressure medication. Ask doctor if you should hold before session.',
    holdOnDialysis: true,
    active: true
  },
  {
    id: 'med-3',
    name: 'Epoetin Alfa (ESA Injection)',
    dose: '4000 IU',
    timing: 'dialysis_days',
    notes: 'Injection for blood count. Given after dialysis session.',
    holdOnDialysis: false,
    active: true
  },
  {
    id: 'med-4',
    name: 'Ferrous Sulfate (Iron)',
    dose: '320mg',
    timing: 'bedtime',
    notes: 'Iron supplement. Take at bedtime on empty stomach.',
    holdOnDialysis: false,
    active: true
  }
];

export function getMedications() {
  const list = read(KEYS.medications, null);
  if (list === null) {
    write(KEYS.medications, DEFAULT_MEDS);
    return DEFAULT_MEDS;
  }
  return list;
}

export function saveMedication(data) {
  const list = getMedications();
  if (data.id) {
    const idx = list.findIndex(m => m.id === data.id);
    if (idx !== -1) list[idx] = { ...list[idx], ...data };
    else list.push({ ...data, id: uid() });
  } else {
    list.push({ ...data, id: uid(), active: true });
  }
  write(KEYS.medications, list);
  emit();
}

export function deleteMedication(id) {
  const list = getMedications().filter(m => m.id !== id);
  write(KEYS.medications, list);
  emit();
}

export function getMedLogs() {
  return read(KEYS.medLogs, {});
}

export function todayMedLogs() {
  const logs = getMedLogs();
  const today = dayKey();
  return logs[today] || {};
}

export function toggleMedicationTaken(medId, slotKey = 'default') {
  const logs = getMedLogs();
  const today = dayKey();
  if (!logs[today]) logs[today] = {};
  const currentKey = `${medId}_${slotKey}`;
  logs[today][currentKey] = !logs[today][currentKey];
  write(KEYS.medLogs, logs);
  emit();
}

/* ---------- pre-dialysis checklist ---------- */

const DEFAULT_CHECKLIST = [
  { id: 'chk-1', text: 'Weigh morning weight on home scale & log in app', done: false },
  { id: 'chk-2', text: 'Check AV Fistula thrill (vibration) / Permcath dressing dry', done: false },
  { id: 'chk-3', text: 'Bring SPMC Dialysis Booklet & PhilHealth GL documents', done: false },
  { id: 'chk-4', text: 'Check BP meds (hold morning dose if ordered by doctor)', done: false },
  { id: 'chk-5', text: 'Bring light renal-friendly snack and water bottle', done: false }
];

export function getTodayChecklist() {
  const stored = read(KEYS.checklists, {});
  const today = dayKey();
  if (!stored[today]) {
    stored[today] = DEFAULT_CHECKLIST;
    write(KEYS.checklists, stored);
  }
  return stored[today];
}

export function toggleChecklistItem(id) {
  const stored = read(KEYS.checklists, {});
  const today = dayKey();
  const list = stored[today] || DEFAULT_CHECKLIST;
  const next = list.map(item => item.id === id ? { ...item, done: !item.done } : item);
  stored[today] = next;
  write(KEYS.checklists, stored);
  emit();
}

/* ---------- intra-dialysis blood pressure ----------
   Nurses check BP repeatedly through a run (pre, then roughly hourly)
   because intradialytic hypotension is the thing that actually happens
   mid-session — a single post-session number, which is all logSession
   captures, cannot show a dip that recovered before the chair. Readings
   are keyed by calendar day rather than by a session id: they are taken
   live, before the post-session summary exists to attach them to. */

/** Universal cuff-reading threshold, not a nurse-set target — the same
    fixed number any home BP monitor flags, unlike idwgLimitKg upstream. */
export const HD_LOW_SYS = 90;

export function isLowSys(sys) {
  return Number.isFinite(sys) && sys < HD_LOW_SYS;
}

export function getHdBp() {
  return read(KEYS.hdBp, []).sort((a, b) => b.ts - a.ts);
}

export function todayHdBp() {
  const today = dayKey();
  return getHdBp().filter(r => r.day === today);
}

export function logHdBp({ sys, dia, pulse, note }, when = new Date()) {
  const list = read(KEYS.hdBp, []);
  const entry = {
    id: uid(), day: dayKey(when), ts: when.getTime(),
    sys: Number(sys), dia: Number(dia),
    pulse: pulse != null && pulse !== '' ? Number(pulse) : null,
    note: note ? String(note) : ''
  };
  list.push(entry);
  write(KEYS.hdBp, list);
  emit();
  return entry;
}

export function deleteHdBp(id) {
  write(KEYS.hdBp, read(KEYS.hdBp, []).filter(r => r.id !== id));
  emit();
}

/** Undo support, matching restoreIntake. */
export function restoreHdBp(entry) {
  const list = read(KEYS.hdBp, []);
  if (!list.some(r => r.id === entry.id)) list.push(entry);
  write(KEYS.hdBp, list);
  emit();
}

/* ---------- export ---------- */

export function buildSummary() {
  const p = getProfile();
  const weights = getWeights().slice(0, 14);
  const sessions = getSessions().slice(0, 6);
  return {
    profile: p,
    generatedAt: new Date().toISOString(),
    idwgKg: idwgKg(),
    limitKg: effectiveLimitKg(),
    gapDays: gapDays(),
    todayIntakeMl: todayIntakeMl(),
    weights,
    sessions
  };
}

export function wipeAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  emit();
}

/* ===================================================================
   Backup / restore.
   Device-only storage means a lost, reset or wiped phone takes years of
   history with it, and Android's "clear browsing data" erases
   localStorage without warning. A file the patient owns is the only
   safety net that does not require a server.
   =================================================================== */

export const EXPORT_APP = 'sktidvo';
export const EXPORT_VERSION = 1;

export function exportAll() {
  return {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: getProfile(),
    weights: getWeights(),
    intake: getIntake(),
    sessions: getSessions(),
    medications: getMedications(),
    medLogs: getMedLogs(),
    hdBp: getHdBp(),
    foodLogs: getFoodLogs(),
    labLogs: getLabLogs()
  };
}

export function exportFilename() {
  return `sktidvo-backup-${dayKey()}.json`;
}

const num = (v, fallback = null) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = v => (typeof v === 'string' ? v : '');

/** A restore file is untrusted input: keep only fields we recognise. */
function cleanWeights(list) {
  return (Array.isArray(list) ? list : [])
    .map(w => ({ id: str(w.id) || uid(), day: str(w.day), ts: num(w.ts, 0), kg: num(w.kg) }))
    .filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w.day) && w.kg > 0 && w.kg < 500);
}

function cleanIntake(list) {
  return (Array.isArray(list) ? list : [])
    .map(i => ({ id: str(i.id) || uid(), day: str(i.day), ts: num(i.ts, 0),
                 ml: num(i.ml), labelKey: str(i.labelKey) || 'fluid.other' }))
    .filter(i => /^\d{4}-\d{2}-\d{2}$/.test(i.day) && i.ml > 0 && i.ml <= 5000);
}

function cleanSessions(list) {
  return (Array.isArray(list) ? list : [])
    .map(s => ({ id: str(s.id) || uid(), day: str(s.day), ts: num(s.ts, 0),
                 preKg: num(s.preKg), postKg: num(s.postKg), ufL: num(s.ufL),
                 bpSys: num(s.bpSys), bpDia: num(s.bpDia) }))
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.day) && s.postKg > 0 && s.postKg < 500);
}

function cleanFoodLogs(list) {
  return (Array.isArray(list) ? list : [])
    .map(e => ({ id: str(e.id) || uid(), day: str(e.day), ts: num(e.ts, 0),
                 meal: MEALS.includes(e.meal) ? e.meal : inferMeal(new Date(num(e.ts, 0) || Date.now())),
                 foodId: str(e.foodId), name: str(e.name).slice(0, 80),
                 serving: str(e.serving).slice(0, 40),
                 servings: num(e.servings, 1),
                 kMg: num(e.kMg, 0), naMg: num(e.naMg, 0),
                 phMg: num(e.phMg, 0), kcal: num(e.kcal, 0),
                 proteinG: num(e.proteinG, 0), fiberG: num(e.fiberG, 0), ml: num(e.ml, 0) }))
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.day) && e.name &&
                  e.kMg >= 0 && e.kMg < 20000 && e.naMg >= 0 && e.naMg < 20000);
}

function cleanHdBp(list) {
  return (Array.isArray(list) ? list : [])
    .map(r => ({ id: str(r.id) || uid(), day: str(r.day), ts: num(r.ts, 0),
                 sys: num(r.sys), dia: num(r.dia),
                 pulse: r.pulse != null ? num(r.pulse) : null,
                 note: str(r.note).slice(0, 200) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day) &&
                  r.sys > 0 && r.sys < 300 && r.dia > 0 && r.dia < 200);
}

function cleanLabLogs(list) {
  return (Array.isArray(list) ? list : [])
    .map(e => ({
      id:          str(e.id) || uid(),
      day:         str(e.day),
      ts:          num(e.ts, 0),
      k:           num(e.k),
      phos:        num(e.phos),
      na:          num(e.na),
      albumin:     num(e.albumin),
      hgb:         num(e.hgb),
      bun:         num(e.bun),
      creatinine:  num(e.creatinine),
      bicarbonate: num(e.bicarbonate),
      calcium:     num(e.calcium),
      uricAcid:    num(e.uricAcid),
      note:        str(e.note).slice(0, 300)
    }))
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.day));
}

function cleanProfile(p) {
  const src = p && typeof p === 'object' ? p : {};
  return {
    ...DEFAULT_PROFILE,
    name:             str(src.name),
    bookletNo:        str(src.bookletNo),
    doctorName:       str(src.doctorName),
    nursePhone:       str(src.nursePhone),
    emergencyPhone:   str(src.emergencyPhone),
    dryWeightKg:      num(src.dryWeightKg),
    allowanceMl:      num(src.allowanceMl, 1000),
    idwgLimitKg:      num(src.idwgLimitKg, 2.0),
    potassiumLimitMg: num(src.potassiumLimitMg, 2000),
    sodiumLimitMg:    num(src.sodiumLimitMg, 2300),
    phosphorusLimitMg:num(src.phosphorusLimitMg, 900),
    kcalGoal:         num(src.kcalGoal, 1800),
    proteinGoalG:     num(src.proteinGoalG, 60),
    fiberGoalG:       num(src.fiberGoalG, 30),
    autoGoalsFromLabs: src.autoGoalsFromLabs !== false,
    labK:             num(src.labK),
    labPhos:          num(src.labPhos),
    labNa:            num(src.labNa),
    labAlbumin:       num(src.labAlbumin),
    labDate:          str(src.labDate),
    schedule:         ['MWF', 'TTS', 'CUSTOM'].includes(src.schedule) ? src.schedule : 'MWF',
    customDays:       Array.isArray(src.customDays) ? src.customDays : [1, 3, 5],
    shiftName:        str(src.shiftName) || '1st Shift',
    sessionTime:      /^\d{2}:\d{2}$/.test(src.sessionTime) ? src.sessionTime : '06:00',
    stationNo:        str(src.stationNo),
    philHealthTarget: num(src.philHealthTarget, 156),
    philHealthUsed:   num(src.philHealthUsed, 0),
    weighTime:        /^\d{2}:\d{2}$/.test(src.weighTime)   ? src.weighTime   : '06:30',
    lang:             ['en', 'ceb', 'tl'].includes(src.lang) ? src.lang : 'en',
    theme:            ['auto', 'light', 'dark'].includes(src.theme) ? src.theme : 'auto',
    setupDone:        !!src.setupDone,
    scaleOffsetKg:    num(src.scaleOffsetKg, 0),
    scaleCalibratedAt: num(src.scaleCalibratedAt)
  };
}

/** Throws on a file that is not one of ours. Replaces everything on success. */
export function importAll(data) {
  if (!data || typeof data !== 'object' || data.app !== EXPORT_APP) {
    throw new Error('not a SKTIDVO backup');
  }
  if (!Number.isFinite(Number(data.version)) || Number(data.version) > EXPORT_VERSION) {
    throw new Error('backup made by a newer version');
  }
  const next = {
    profile:     cleanProfile(data.profile),
    weights:     cleanWeights(data.weights),
    intake:      cleanIntake(data.intake),
    sessions:    cleanSessions(data.sessions),
    medications: Array.isArray(data.medications) ? data.medications : DEFAULT_MEDS,
    medLogs:     (data.medLogs && typeof data.medLogs === 'object') ? data.medLogs : {},
    hdBp:        cleanHdBp(data.hdBp),
    foodLogs:    cleanFoodLogs(data.foodLogs),
    labLogs:     cleanLabLogs(data.labLogs)
  };
  write(KEYS.profile,     next.profile);
  write(KEYS.weights,     next.weights);
  write(KEYS.intake,      next.intake);
  write(KEYS.sessions,    next.sessions);
  write(KEYS.medications, next.medications);
  write(KEYS.medLogs,     next.medLogs);
  write(KEYS.hdBp,        next.hdBp);
  write(KEYS.foodLogs,    next.foodLogs);
  write(KEYS.labLogs,     next.labLogs);
  emit();
  return {
    weights: next.weights.length,
    intake: next.intake.length,
    sessions: next.sessions.length,
    medications: next.medications.length,
    hdBp: next.hdBp.length,
    foodLogs: next.foodLogs.length,
    labLogs: next.labLogs.length
  };
}

/* ---------- storage durability ----------
   Without this the browser treats our data as evictable cache. */

export async function requestPersistence() {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isPersisted() {
  if (!navigator.storage?.persisted) return null;
  try { return await navigator.storage.persisted(); } catch { return null; }
}
