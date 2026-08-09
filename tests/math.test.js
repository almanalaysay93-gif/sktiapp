/* ===================================================================
   Tests for the clinical maths in store.js.

   These run in the browser because store.js talks to localStorage
   directly. The runner snapshots every skti.v1.* key before the suite
   and restores it after, so running the tests never destroys a real
   patient's history on a shared device.
   =================================================================== */

import * as S from '../js/store.js';
import { suite, test, eq, near, throws, results, resetResults } from './harness.js';

/* ---------- fixtures ---------- */

/* Every key store.js writes to. reset() calls S.wipeAll(), which clears
   all of them — if one is missing here it is gone for good on a real
   device once the suite finishes, not just during the run. */
const KEYS = ['skti.v1.profile', 'skti.v1.weights', 'skti.v1.intake', 'skti.v1.sessions',
              'skti.v1.medications', 'skti.v1.med_logs', 'skti.v1.checklists', 'skti.v1.hd_bp'];

function snapshot() {
  return KEYS.map(k => [k, localStorage.getItem(k)]);
}
function restore(snap) {
  KEYS.forEach(k => localStorage.removeItem(k));
  snap.forEach(([k, v]) => { if (v !== null) localStorage.setItem(k, v); });
}

function reset(profile = {}) {
  S.wipeAll();
  S.saveProfile({
    dryWeightKg: 62, allowanceMl: 800, idwgLimitKg: 2.0,
    schedule: 'MWF', setupDone: true, ...profile
  });
}

/** A date N days before today, as a Date. */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d;
}

/* ===================================================================
   Suites
   =================================================================== */

export function runMathTests() {
  const snap = snapshot();

  try {
    /* ---------- dates ---------- */
    suite('dates');

    test('dayKey formats as local YYYY-MM-DD', () => {
      const d = new Date(2026, 6, 27, 23, 30);      // 27 Jul 2026, 23:30 local
      eq(S.dayKey(d), '2026-07-27');
    });

    test('dayKey uses local midnight, not UTC', () => {
      // 00:30 local on the 27th is still the 26th in UTC for PH (+08).
      const d = new Date(2026, 6, 27, 0, 30);
      eq(S.dayKey(d), '2026-07-27');
    });

    test('daysBetween counts calendar days', () => {
      eq(S.daysBetween('2026-07-24', '2026-07-27'), 3);
      eq(S.daysBetween('2026-07-27', '2026-07-27'), 0);
    });

    test('daysBetween spans month end', () => {
      eq(S.daysBetween('2026-07-31', '2026-08-02'), 2);
    });

    /* ---------- gap + limit ---------- */
    suite('gap and limit');

    test('no session means no gap', () => {
      reset();
      eq(S.gapDays(), null);
      near(S.effectiveLimitKg(), 2.0);
    });

    test('the normal two-day gap uses the nurse figure unchanged', () => {
      // Mon->Wed and Wed->Fri are both two days. This is the common case
      // and must not silently inflate the limit the nurse gave.
      reset();
      S.logSession({ postKg: 62.0 }, daysAgo(2));
      eq(S.gapDays(), 2);
      near(S.effectiveLimitKg(), 2.0);
    });

    test('the long weekend gap allows proportionally more', () => {
      reset();
      S.logSession({ postKg: 62.0 }, daysAgo(3));
      eq(S.gapDays(), 3);
      near(S.effectiveLimitKg(), 3.0);
    });

    test('an unusually short gap allows less', () => {
      reset();
      S.logSession({ postKg: 62.0 });
      eq(S.gapDays(), 1);
      near(S.effectiveLimitKg(), 1.0);
    });

    test('a long lapse in treatment does not licence an unlimited gain', () => {
      reset();
      S.logSession({ postKg: 62.0 }, daysAgo(9));
      eq(S.gapDays(), 9);
      near(S.effectiveLimitKg(), 3.0, 0.001, 'should cap at the 3-day figure: ');
    });

    test('limit scales off the patient-set base, not a constant', () => {
      reset({ idwgLimitKg: 1.4 });
      S.logSession({ postKg: 62.0 }, daysAgo(2));
      near(S.effectiveLimitKg(), 1.4);
      S.wipeAll();
      S.saveProfile({ idwgLimitKg: 1.4, allowanceMl: 800, setupDone: true });
      S.logSession({ postKg: 62.0 }, daysAgo(3));
      near(S.effectiveLimitKg(), 2.1);
    });

    /* ---------- IDWG ---------- */
    suite('IDWG');

    test('needs both a session and a weight', () => {
      reset();
      eq(S.idwgKg(), null);
      S.logSession({ postKg: 62.0 });
      eq(S.idwgKg(), null, 'session but no weight: ');
    });

    test('gain is morning weight minus post-dialysis weight', () => {
      reset();
      S.logSession({ postKg: 62.5 }, daysAgo(1));
      S.logWeight(64.0);
      near(S.idwgKg(), 1.5);
    });

    test('a home scale reading high is subtracted out', () => {
      reset();
      S.logSession({ postKg: 62.5 }, daysAgo(1));
      S.setScaleOffset(63.3, 62.5);          // home reads 0.8 kg heavy
      S.logWeight(64.0);                     // raw gain would look like 1.5
      near(S.idwgKg(), 0.7);
    });

    test('a home scale reading low is added back', () => {
      reset();
      S.logSession({ postKg: 62.5 }, daysAgo(1));
      S.setScaleOffset(62.0, 62.5);          // home reads 0.5 kg light
      S.logWeight(64.0);
      near(S.idwgKg(), 2.0);
    });

    test('uncalibrated means a zero offset, not a broken sum', () => {
      reset();
      eq(S.isCalibrated(), false);
      S.logSession({ postKg: 62.5 }, daysAgo(1));
      S.logWeight(64.0);
      near(S.idwgKg(), 1.5);
    });

    test('calibration is recorded', () => {
      reset();
      S.setScaleOffset(63.0, 62.5);
      eq(S.isCalibrated(), true);
      near(S.getProfile().scaleOffsetKg, 0.5);
    });

    test('losing weight below dry weight gives a negative gain', () => {
      reset();
      S.logSession({ postKg: 62.5 }, daysAgo(1));
      S.logWeight(62.0);
      near(S.idwgKg(), -0.5);
    });

    /* ---------- bands ---------- */
    suite('bands');

    // Two days is the normal MWF/TTS interval, so the limit here is the
    // patient's 2.0 kg exactly.
    const bandFor = kg => {
      reset();
      S.logSession({ postKg: 60.0 }, daysAgo(2));
      S.logWeight(60.0 + kg);
      return S.band();
    };

    test('no data means no band', () => {
      reset();
      eq(S.band(), null);
    });

    test('well under the limit is ok', () => eq(bandFor(0.5), 'ok'));

    test('exactly 70% of the limit is still ok', () => eq(bandFor(1.4), 'ok'));

    test('just past 70% flips to warn', () => eq(bandFor(1.41), 'warn'));

    test('exactly at the limit is warn, not danger', () => eq(bandFor(2.0), 'warn'));

    test('past the limit is danger', () => eq(bandFor(2.01), 'danger'));

    test('the long weekend gap widens the bands', () => {
      // Each call starts from a clean store: a stale newer session would
      // otherwise win lastSession() and silently change the gap.
      const bandOverGap = (kg, gap) => {
        reset();
        S.logSession({ postKg: 60.0 }, daysAgo(gap));
        S.logWeight(60.0 + kg);
        return S.band();
      };
      // 2.5 kg is over the limit on a normal interval, acceptable-ish
      // after the weekend.
      eq(bandOverGap(2.5, 2), 'danger', '2.5 kg over the normal 2-day gap: ');
      eq(bandOverGap(2.5, 3), 'warn',   'the same 2.5 kg after the weekend: ');
      eq(bandOverGap(2.0, 2), 'warn',   '2.0 kg over the normal 2-day gap: ');
      eq(bandOverGap(2.0, 3), 'ok',     'the same 2.0 kg after the weekend: ');
    });

    /* ---------- fluid ---------- */
    suite('fluid');

    test('allowance minus what was logged', () => {
      reset();
      S.logIntake(250, 'fluid.glass');
      S.logIntake(200, 'fluid.cup');
      eq(S.todayIntakeMl(), 450);
      eq(S.fluidLeftMl(), 350);
    });

    test('food fluid counts the same as drinks', () => {
      reset();
      S.logIntake(240, 'fluid.sabaw');
      S.logIntake(120, 'fluid.yelo');
      eq(S.todayIntakeMl(), 360);
    });

    test('going over gives a negative remainder', () => {
      reset();
      S.logIntake(900, 'fluid.other');
      eq(S.fluidLeftMl(), -100);
    });

    test('glasses left never goes negative', () => {
      reset();
      S.logIntake(900, 'fluid.other');
      eq(S.glassesLeft(), 0);
    });

    test('glasses left rounds down', () => {
      reset();
      S.logIntake(200, 'fluid.cup');         // 600 left = 2.4 glasses
      eq(S.glassesLeft(), 2);
    });

    test('no allowance set means no figure to show', () => {
      reset({ allowanceMl: null });
      eq(S.fluidLeftMl(), null);
      eq(S.glassesLeft(), null);
    });

    test('deleting an entry frees the allowance again', () => {
      reset();
      const e = S.logIntake(500, 'fluid.bottle');
      eq(S.todayIntakeMl(), 500);
      S.deleteIntake(e.id);
      eq(S.todayIntakeMl(), 0);
    });

    test('restore puts the same entry back once', () => {
      reset();
      const e = S.logIntake(500, 'fluid.bottle');
      S.deleteIntake(e.id);
      S.restoreIntake(e);
      S.restoreIntake(e);                    // double undo must not double count
      eq(S.todayIntakeMl(), 500);
    });

    /* ---------- intra-dialysis blood pressure ---------- */
    suite('hd bp');

    test('a reading is stamped with today and is retrievable', () => {
      reset();
      S.logHdBp({ sys: 118, dia: 76, pulse: 70, note: '' });
      eq(S.todayHdBp().length, 1);
      eq(S.getHdBp().length, 1);
    });

    test('multiple readings the same day all survive', () => {
      // This is the point of the feature: several checks through one run,
      // not one post-session number.
      reset();
      S.logHdBp({ sys: 130, dia: 82 });
      S.logHdBp({ sys: 122, dia: 78 });
      S.logHdBp({ sys: 95,  dia: 60 });
      eq(S.todayHdBp().length, 3);
    });

    test('newest reading comes first', () => {
      reset();
      const earlier = new Date(); earlier.setHours(9, 0, 0, 0);
      const later   = new Date(); later.setHours(11, 0, 0, 0);
      S.logHdBp({ sys: 130, dia: 82 }, earlier);
      S.logHdBp({ sys: 110, dia: 70 }, later);
      eq(S.getHdBp()[0].sys, 110);
    });

    test('a reading from a past session day does not show under today', () => {
      reset();
      S.logHdBp({ sys: 120, dia: 80 }, daysAgo(2));
      eq(S.todayHdBp().length, 0);
      eq(S.getHdBp().length, 1);
    });

    test('pulse and note are optional', () => {
      reset();
      const e = S.logHdBp({ sys: 118, dia: 76 });
      eq(e.pulse, null);
      eq(e.note, '');
    });

    test('a note is kept as typed', () => {
      reset();
      const e = S.logHdBp({ sys: 118, dia: 76, note: 'nalipong' });
      eq(e.note, 'nalipong');
    });

    test('below 90 systolic is flagged low', () => {
      eq(S.isLowSys(89), true);
      eq(S.isLowSys(90), false, '90 itself is the boundary, not below it: ');
      eq(S.isLowSys(120), false);
    });

    test('isLowSys ignores non-numbers rather than throwing', () => {
      eq(S.isLowSys(null), false);
      eq(S.isLowSys(undefined), false);
      eq(S.isLowSys(NaN), false);
    });

    test('deleting a reading removes it', () => {
      reset();
      const e = S.logHdBp({ sys: 118, dia: 76 });
      S.deleteHdBp(e.id);
      eq(S.todayHdBp().length, 0);
    });

    test('restore puts a deleted reading back once', () => {
      reset();
      const e = S.logHdBp({ sys: 118, dia: 76 });
      S.deleteHdBp(e.id);
      S.restoreHdBp(e);
      S.restoreHdBp(e);                      // double undo must not double count
      eq(S.todayHdBp().length, 1);
    });

    test('is included in a full export', () => {
      reset();
      S.logHdBp({ sys: 118, dia: 76, pulse: 70, note: 'ok' });
      const dump = S.exportAll();
      eq(dump.hdBp.length, 1);
      eq(dump.hdBp[0].sys, 118);
    });

    test('a restore round-trips the readings', () => {
      reset();
      S.logHdBp({ sys: 118, dia: 76 });
      S.logHdBp({ sys: 92,  dia: 58 });
      const dump = JSON.parse(JSON.stringify(S.exportAll()));
      S.wipeAll();
      eq(S.getHdBp().length, 0, 'wipe should clear: ');
      const counts = S.importAll(dump);
      eq(counts.hdBp, 2);
      eq(S.getHdBp().length, 2);
    });

    test('import drops readings with impossible numbers', () => {
      reset();
      const counts = S.importAll({
        app: 'sktidvo', version: 1,
        profile: {}, weights: [], intake: [], sessions: [],
        hdBp: [
          { day: '2026-07-27', sys: 120, dia: 80 },       // good
          { day: '2026-07-27', sys: 400, dia: 80 },       // impossible systolic
          { day: '2026-07-27', sys: 120, dia: 0 },        // impossible diastolic
          { day: 'not-a-date', sys: 120, dia: 80 }        // bad day
        ]
      });
      eq(counts.hdBp, 1);
    });

    /* ---------- weights ---------- */
    suite('weights');

    test('a second weigh-in replaces the first for that day', () => {
      reset();
      S.logWeight(64.0);
      S.logWeight(63.4);
      eq(S.getWeights().length, 1);
      near(S.todayWeight().kg, 63.4);
    });

    test('yesterday is kept when today is replaced', () => {
      reset();
      S.logWeight(65.0, daysAgo(1));
      S.logWeight(64.0);
      S.logWeight(63.4);
      eq(S.getWeights().length, 2);
    });

    test('weights come back newest first', () => {
      reset();
      S.logWeight(65.0, daysAgo(2));
      S.logWeight(64.0, daysAgo(1));
      S.logWeight(63.0);
      near(S.getWeights()[0].kg, 63.0);
    });

    /* ---------- schedule ---------- */
    suite('schedule');

    test('MWF lands on Mon, Wed or Fri', () => {
      reset({ schedule: 'MWF' });
      eq([1, 3, 5].includes(S.nextSessionDate().getDay()), true);
    });

    test('TTS lands on Tue, Thu or Sat', () => {
      reset({ schedule: 'TTS' });
      eq([2, 4, 6].includes(S.nextSessionDate().getDay()), true);
    });

    test('a session already logged today points at the next one', () => {
      reset({ schedule: 'MWF' });
      S.logSession({ postKg: 62.0 });
      const next = S.nextSessionDate();
      eq(S.dayKey(next) !== S.dayKey(), true);
    });

    /* ---------- backup ---------- */
    suite('backup');

    test('export carries every record', () => {
      reset();
      S.logWeight(64.0);
      S.logIntake(250, 'fluid.glass');
      S.logSession({ postKg: 62.5 });
      const dump = S.exportAll();
      eq(dump.app, 'sktidvo');
      eq(dump.weights.length, 1);
      eq(dump.intake.length, 1);
      eq(dump.sessions.length, 1);
      near(dump.profile.dryWeightKg, 62);
    });

    test('a full round trip preserves the numbers', () => {
      reset();
      S.setScaleOffset(63.0, 62.5);
      S.logWeight(64.0);
      S.logSession({ postKg: 62.5 }, daysAgo(1));
      const dump = JSON.parse(JSON.stringify(S.exportAll()));
      S.wipeAll();
      eq(S.getWeights().length, 0, 'wipe should clear: ');
      S.importAll(dump);
      near(S.getProfile().scaleOffsetKg, 0.5);
      near(S.idwgKg(), 1.0);                 // 64.0 - 0.5 offset - 62.5
    });

    test('a foreign file is rejected', () => {
      reset();
      throws(() => S.importAll({ app: 'something-else', version: 1 }));
      throws(() => S.importAll(null));
      throws(() => S.importAll({ app: 'sktidvo', version: 99 }));
    });

    test('junk records are dropped, good ones kept', () => {
      reset();
      const counts = S.importAll({
        app: 'sktidvo', version: 1,
        profile: { dryWeightKg: 60 },
        weights: [
          { day: '2026-07-27', kg: 64 },
          { day: 'not-a-date', kg: 64 },     // bad day
          { day: '2026-07-26', kg: 900 },    // impossible weight
          { day: '2026-07-25', kg: 'abc' }   // not a number
        ],
        intake: [{ day: '2026-07-27', ml: 250 }, { day: '2026-07-27', ml: -5 }],
        sessions: [{ day: '2026-07-27', postKg: 62 }, { day: '2026-07-27', postKg: 0 }]
      });
      eq(counts.weights, 1);
      eq(counts.intake, 1);
      eq(counts.sessions, 1);
    });

    test('import cannot smuggle in unknown profile fields', () => {
      reset();
      S.importAll({
        app: 'sktidvo', version: 1,
        profile: { dryWeightKg: 60, schedule: 'XYZ', lang: 'fr', evil: true },
        weights: [], intake: [], sessions: []
      });
      const p = S.getProfile();
      eq(p.schedule, 'MWF', 'bad schedule should fall back: ');
      eq(p.lang, 'en', 'unknown language should fall back: ');
      eq(p.evil, undefined, 'unknown key should not survive: ');
    });

  } finally {
    restore(snap);
  }
}
