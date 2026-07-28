/* ===================================================================
   Tests for calendar.js — RFC 5545 output and Google Calendar links.

   A malformed .ics fails silently: the calendar app just refuses the
   import and the patient has no idea why. So the escaping, folding and
   line endings are worth pinning down.
   =================================================================== */

import * as C from '../js/calendar.js';
import { suite, test, eq, includes, notIncludes, match } from './harness.js';

export function runCalendarTests() {

  /* ---------- escaping ---------- */
  suite('ics escaping');

  test('escapes the four special characters', () => {
    eq(C.escapeText('a;b,c\\d'), 'a\\;b\\,c\\\\d');
  });

  test('escapes backslash before anything else', () => {
    // A naive order would turn \ into \\ and then re-escape its own output.
    eq(C.escapeText('\\;'), '\\\\\\;');
  });

  test('turns newlines into literal \\n', () => {
    eq(C.escapeText('one\ntwo'), 'one\\ntwo');
    eq(C.escapeText('one\r\ntwo'), 'one\\ntwo');
  });

  test('handles null and undefined', () => {
    eq(C.escapeText(null), '');
    eq(C.escapeText(undefined), '');
  });

  /* ---------- folding ---------- */
  suite('ics folding');

  test('short lines are untouched', () => {
    eq(C.fold('SUMMARY:Dialysis'), 'SUMMARY:Dialysis');
  });

  test('a line at exactly 75 octets is not folded', () => {
    const line = 'X'.repeat(75);
    eq(C.fold(line).includes('\r\n'), false);
  });

  test('a 76 octet line folds once', () => {
    const folded = C.fold('X'.repeat(76));
    const parts = folded.split('\r\n');
    eq(parts.length, 2);
    eq(parts[1].startsWith(' '), true, 'continuation must start with a space: ');
  });

  test('no folded segment exceeds 75 octets', () => {
    const folded = C.fold('SUMMARY:' + 'abcde '.repeat(60));
    const enc = new TextEncoder();
    const tooLong = folded.split('\r\n').filter(l => enc.encode(l).length > 75);
    eq(tooLong.length, 0);
  });

  test('multi-byte characters are never split', () => {
    // "ñ" and "—" are 2 and 3 octets; a naive slice would corrupt them.
    const folded = C.fold('DESCRIPTION:' + 'ñ—'.repeat(40));
    const rejoined = folded.split('\r\n').map((l, i) => i ? l.slice(1) : l).join('');
    eq(rejoined, 'DESCRIPTION:' + 'ñ—'.repeat(40));
    eq(folded.includes('�'), false, 'no replacement characters: ');
  });

  /* ---------- date formatting ---------- */
  suite('ics dates');

  test('local time has no timezone marker', () => {
    eq(C.icsLocal(new Date(2026, 6, 27, 8, 0)), '20260727T080000');
  });

  test('local time pads single digits', () => {
    eq(C.icsLocal(new Date(2026, 0, 5, 6, 30)), '20260105T063000');
  });

  test('utc stamp ends in Z', () => {
    match(C.icsUtc(new Date(Date.UTC(2026, 6, 27, 0, 30))), /^20260727T003000Z$/);
  });

  test('atTime puts the clock time on the given day', () => {
    const d = C.atTime(new Date(2026, 6, 27), '14:45');
    eq(C.icsLocal(d), '20260727T144500');
  });

  test('atTime falls back to 08:00 on junk', () => {
    eq(C.icsLocal(C.atTime(new Date(2026, 6, 27), 'nonsense')), '20260727T080000');
  });

  /* ---------- schedule ---------- */
  suite('ics schedule');

  const sched = (o = {}) => C.scheduleIcs({ from: new Date(2026, 6, 27, 0, 0), ...o });

  test('MWF maps to Monday, Wednesday, Friday', () => {
    includes(sched({ schedule: 'MWF' }), 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });

  test('TTS maps to Tuesday, Thursday, Saturday', () => {
    includes(sched({ schedule: 'TTS' }), 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH,SA');
  });

  test('an unknown schedule falls back to MWF', () => {
    includes(sched({ schedule: 'XYZ' }), 'BYDAY=MO,WE,FR');
  });

  test('carries an alarm before the appointment', () => {
    const ics = sched({ alarmMinutesBefore: 120 });
    includes(ics, 'BEGIN:VALARM');
    includes(ics, 'TRIGGER:-PT120M');
    includes(ics, 'ACTION:DISPLAY');
  });

  test('uses the configured chair time', () => {
    includes(sched({ sessionTime: '13:30' }), 'DTSTART:20260727T133000');
  });

  test('ends after the configured duration', () => {
    includes(sched({ sessionTime: '08:00', durationMinutes: 240 }), 'DTEND:20260727T120000');
  });

  test('every line ends with CRLF', () => {
    const ics = sched();
    eq(/[^\r]\n/.test(ics), false, 'found a bare LF: ');
    eq(ics.endsWith('\r\n'), true);
  });

  test('is a well formed VCALENDAR', () => {
    const ics = sched();
    match(ics, /^BEGIN:VCALENDAR\r\n/);
    includes(ics, 'VERSION:2.0');
    includes(ics, 'END:VCALENDAR');
    eq((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
    eq((ics.match(/END:VEVENT/g) || []).length, 1);
  });

  test('every event has a UID and a DTSTAMP', () => {
    const ics = sched();
    match(ics, /UID:[^\r\n]+@skti-tubig\.local/);
    match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
  });

  test('the UID is stable so re-import updates instead of duplicating', () => {
    const uid = s => s.match(/UID:([^\r\n]+)/)[1];
    eq(uid(sched({ schedule: 'MWF', sessionTime: '08:00' })),
       uid(sched({ schedule: 'MWF', sessionTime: '08:00' })));
  });

  test('a different chair time is a different event', () => {
    const uid = s => s.match(/UID:([^\r\n]+)/)[1];
    eq(uid(sched({ sessionTime: '08:00' })) === uid(sched({ sessionTime: '13:00' })), false);
  });

  /* ---------- weigh-in ---------- */
  suite('ics weigh-in');

  test('repeats daily', () => {
    includes(C.weighInIcs({ weighTime: '06:30' }), 'RRULE:FREQ=DAILY');
  });

  test('alarms at the moment of the event', () => {
    includes(C.weighInIcs({ alarmMinutesBefore: 0 }), 'TRIGGER:-PT0M');
  });

  /* ---------- session log ---------- */
  suite('ics session log');

  const sessions = [
    { id: 'a1', day: '2026-07-27', postKg: 62.5, ufL: 2.1, bpSys: 130, bpDia: 80 },
    { id: 'b2', day: '2026-07-24', postKg: 62.0, ufL: null, bpSys: null, bpDia: null }
  ];

  test('one event per session', () => {
    const ics = C.sessionsIcs({ sessions });
    eq((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  });

  test('carries the clinical numbers in the description', () => {
    const ics = C.sessionsIcs({ sessions, labels: { post: 'Weight after', uf: 'Fluid removed', bp: 'BP' } });
    includes(ics, 'Weight after: 62.5 kg');
    includes(ics, 'Fluid removed: 2.1 L');
    includes(ics, 'BP: 130/80');
  });

  test('omits fields that were never recorded', () => {
    const ics = C.sessionsIcs({ sessions: [sessions[1]] });
    notIncludes(ics, 'Fluid removed');
    notIncludes(ics, 'null');
  });

  test('multi-line descriptions are escaped, not literal newlines', () => {
    const ics = C.sessionsIcs({ sessions: [sessions[0]] });
    match(ics, /DESCRIPTION:[^\r\n]*\\n/);
  });

  test('skips a session with an unparseable date', () => {
    const ics = C.sessionsIcs({ sessions: [{ id: 'x', day: 'garbage', postKg: 60 }] });
    eq((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
  });

  test('an empty log is still a valid calendar', () => {
    const ics = C.sessionsIcs({ sessions: [] });
    match(ics, /^BEGIN:VCALENDAR\r\n/);
    includes(ics, 'END:VCALENDAR');
  });

  /* ---------- Google link ---------- */
  suite('google calendar link');

  const url = (o = {}) => C.googleTemplateUrl({
    start: new Date(2026, 6, 27, 8, 0), ...o
  });

  test('points at the Google Calendar template endpoint', () => {
    match(url(), /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    includes(url(), 'action=TEMPLATE');
  });

  test('carries the start and end as a date range', () => {
    includes(url({ durationMinutes: 240 }), 'dates=20260727T080000%2F20260727T120000');
  });

  test('pins the timezone so the time is not reinterpreted', () => {
    includes(url(), 'ctz=Asia%2FManila');
  });

  test('repeats when a schedule is given', () => {
    includes(url({ schedule: 'TTS' }), 'BYDAY%3DTU%2CTH%2CSA');
  });

  test('is a one-off when no schedule is given', () => {
    notIncludes(url(), 'recur');
  });

  test('never puts health data in the query string', () => {
    // The URL reaches Google and is kept in browser history.
    const u = url({ title: 'Dialysis — SKTI', schedule: 'MWF' });
    ['kg', 'weight', 'timbang', 'bp', 'mmHg', '62.5'].forEach(term => {
      notIncludes(u.toLowerCase(), term.toLowerCase());
    });
  });
}
