/* ===================================================================
   store.js — all state lives on the device. No server, no account.
   localStorage, namespaced and versioned so a future schema change
   can migrate instead of wiping a patient's history.
   =================================================================== */

const NS = 'skti.v1.';
const KEYS = {
  profile:     NS + 'profile',
  weights:     NS + 'weights',
  intake:      NS + 'intake',
  sessions:    NS + 'sessions',
  medications: NS + 'medications',
  medLogs:     NS + 'med_logs',
  checklists:  NS + 'checklists',
  hdBp:        NS + 'hd_bp'
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
    hdBp: getHdBp()
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

function cleanHdBp(list) {
  return (Array.isArray(list) ? list : [])
    .map(r => ({ id: str(r.id) || uid(), day: str(r.day), ts: num(r.ts, 0),
                 sys: num(r.sys), dia: num(r.dia),
                 pulse: r.pulse != null ? num(r.pulse) : null,
                 note: str(r.note).slice(0, 200) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.day) &&
                  r.sys > 0 && r.sys < 300 && r.dia > 0 && r.dia < 200);
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
    hdBp:        cleanHdBp(data.hdBp)
  };
  write(KEYS.profile,     next.profile);
  write(KEYS.weights,     next.weights);
  write(KEYS.intake,      next.intake);
  write(KEYS.sessions,    next.sessions);
  write(KEYS.medications, next.medications);
  write(KEYS.medLogs,     next.medLogs);
  write(KEYS.hdBp,        next.hdBp);
  emit();
  return {
    weights: next.weights.length,
    intake: next.intake.length,
    sessions: next.sessions.length,
    medications: next.medications.length,
    hdBp: next.hdBp.length
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
