/* ===================================================================
   calendar.js — iCalendar (RFC 5545) output and Google Calendar links.

   Why a file and not the Google Calendar API: the API needs OAuth, a
   registered Cloud project and a round trip of patient health data to
   Google's servers. An .ics file is generated on the device and only
   leaves it if the patient imports it themselves. It also carries
   VALARM, which is the one way this app can produce a reminder that
   fires without a push server.

   Times are written as floating local time (no Z, no TZID). That is
   correct here: a dialysis appointment is at 08:00 wherever the
   patient's phone is, and it avoids shipping a VTIMEZONE block.

   Everything in this file is pure — no DOM, no storage — so it can be
   tested directly.
   =================================================================== */

const CRLF = '\r\n';
const PRODID = '-//SKTIDVO//Fluid and Weight Tracker//EN';
const UID_DOMAIN = 'sktidvo.local';

const pad = n => String(n).padStart(2, '0');

/* ---------- primitives ---------- */

/** RFC 5545 §3.3.11 — backslash, semicolon, comma and newline are special. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 — no line may exceed 75 octets; continuations begin
 * with a single space. Counts octets, not characters, and never splits
 * a multi-byte sequence (Bisaya and Tagalog text is UTF-8).
 */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;

  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {                 // iterates whole code points
    const n = enc.encode(ch).length;
    if (bytes + n > 75) {
      out.push(cur);
      cur = ' ';                           // continuation marker, 1 octet
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join(CRLF);
}

/** Floating local date-time: 20260727T080000 */
export function icsLocal(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
         `T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

/** UTC stamp, required on every VEVENT: 20260727T003000Z */
export function icsUtc(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 'HH:MM' plus a Date -> a new Date on that day at that time. */
export function atTime(day, hhmm) {
  const [h, m] = String(hhmm || '08:00').split(':').map(Number);
  const d = new Date(day);
  d.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

export function addMinutes(d, mins) {
  return new Date(d.getTime() + mins * 60000);
}

const BYDAY = { MWF: 'MO,WE,FR', TTS: 'TU,TH,SA' };
const DOW_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const byDayFor = (schedule, customDays) =>
  schedule === 'CUSTOM' && Array.isArray(customDays) && customDays.length
    ? customDays.slice().sort().map(d => DOW_CODE[d]).join(',')
    : BYDAY[schedule] || BYDAY.MWF;

/* ---------- components ---------- */

/**
 * One VEVENT. `uid` must be stable for a given logical event so that
 * re-importing updates it instead of creating a duplicate.
 */
export function vevent({
  uid, start, end, summary, description = '',
  rrule = null, alarmMinutesBefore = null, alarmText = '', stamp = new Date()
}) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}@${UID_DOMAIN}`,
    `DTSTAMP:${icsUtc(stamp)}`,
    `DTSTART:${icsLocal(start)}`,
    `DTEND:${icsLocal(end)}`,
    `SUMMARY:${escapeText(summary)}`
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (alarmMinutesBefore != null) {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:-PT${alarmMinutesBefore}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(alarmText || summary)}`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

export function wrapCalendar(eventLines) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...eventLines,
    'END:VCALENDAR'
  ].map(fold).join(CRLF) + CRLF;
}

/* ===================================================================
   The three things a patient would want on their calendar
   =================================================================== */

/**
 * Recurring dialysis appointments, with an alarm before each one.
 * No clinical values here — a repeating appointment title is enough,
 * and it keeps the event readable if the calendar is shared.
 */
export function scheduleIcs({
  schedule = 'MWF', customDays = null, sessionTime = '08:00', durationMinutes = 240,
  summary = 'Dialysis — SKTI', description = '',
  alarmMinutesBefore = 120, alarmText = '', from = new Date(), stamp
}) {
  const start = atTime(from, sessionTime);
  return wrapCalendar(vevent({
    uid: `schedule-${schedule}-${sessionTime.replace(':', '')}`,
    start,
    end: addMinutes(start, durationMinutes),
    summary,
    description,
    rrule: `FREQ=WEEKLY;BYDAY=${byDayFor(schedule, customDays)}`,
    alarmMinutesBefore,
    alarmText,
    stamp
  }));
}

/** Daily morning weigh-in nudge. The alarm is the whole point. */
export function weighInIcs({
  weighTime = '06:30', summary = 'Weigh yourself', description = '',
  alarmMinutesBefore = 0, alarmText = '', from = new Date(), stamp
}) {
  const start = atTime(from, weighTime);
  return wrapCalendar(vevent({
    uid: `weighin-${weighTime.replace(':', '')}`,
    start,
    end: addMinutes(start, 10),
    summary,
    description,
    rrule: 'FREQ=DAILY',
    alarmMinutesBefore,
    alarmText,
    stamp
  }));
}

/**
 * Completed sessions as past events. This one does carry clinical
 * numbers, which is the point of a log — the caller warns the patient
 * before it is imported anywhere.
 */
export function sessionsIcs({
  sessions = [], sessionTime = '08:00', durationMinutes = 240,
  summary = 'Dialysis — SKTI', labels = {}, stamp
}) {
  const L = { post: 'Weight after', uf: 'Fluid removed', bp: 'Blood pressure', ...labels };
  const events = sessions.flatMap(s => {
    const day = new Date(s.day + 'T00:00:00');
    if (Number.isNaN(day.getTime())) return [];
    const start = atTime(day, sessionTime);
    const detail = [
      `${L.post}: ${s.postKg} kg`,
      s.ufL   != null ? `${L.uf}: ${s.ufL} L` : null,
      s.bpSys != null ? `${L.bp}: ${s.bpSys}/${s.bpDia ?? '-'}` : null
    ].filter(Boolean).join('\n');
    return vevent({
      uid: `session-${s.id}`,
      start,
      end: addMinutes(start, durationMinutes),
      summary,
      description: detail,
      stamp
    });
  });
  return wrapCalendar(events);
}

/* ===================================================================
   Google Calendar template link — opens a prefilled event, no OAuth.

   Deliberately carries no clinical values: the query string travels to
   Google and lands in browser history. Title and time only.
   =================================================================== */

export function googleTemplateUrl({
  title = 'Dialysis — SKTI', start, durationMinutes = 240,
  schedule = null, customDays = null, tz = 'Asia/Manila'
}) {
  const end = addMinutes(start, durationMinutes);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${icsLocal(start)}/${icsLocal(end)}`,
    ctz: tz
  });
  if (schedule) {
    params.set('recur', `RRULE:FREQ=WEEKLY;BYDAY=${byDayFor(schedule, customDays)}`);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
