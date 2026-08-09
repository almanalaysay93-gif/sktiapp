/* ===================================================================
   app.js — views, rendering, interaction.
   No framework: this has to boot fast on a cheap Android and work
   with the radio off.
   =================================================================== */

import { t, setLang, getLang, LANGS, langName, glassWord } from './i18n.js';
import * as S from './store.js';
import * as Cal from './calendar.js';

/* ---------- tiny helpers ---------- */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape anything that reaches innerHTML. Patient-entered names go here. */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

const nf = (n, d = 1) => Number(n).toFixed(d);

const localeTag = () => ({ ceb: 'fil-PH', tl: 'fil-PH', en: 'en-PH' }[getLang()]);

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(localeTag(), { day: 'numeric', month: 'short' });
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(localeTag(), { hour: 'numeric', minute: '2-digit' });
}

/* ---------- app state (view only; data lives in store) ---------- */

let view = 'today';
let calCursor = new Date();   // month currently shown on Today's calendar

/* ===================================================================
   Toast
   =================================================================== */

function toast(msg, actionLabel, onAction) {
  const wrap = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');          // polite; must not steal focus
  el.innerHTML = `${icon('check')}<span>${esc(msg)}</span>`;
  if (actionLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = actionLabel;
    b.addEventListener('click', () => { onAction?.(); el.remove(); });
    el.appendChild(b);
  }
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ===================================================================
   Sheet (bottom modal)
   =================================================================== */

let lastFocused = null;

function openSheet({ title, body, onMount }) {
  closeSheet();
  lastFocused = document.activeElement;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.id = 'scrim';
  scrim.addEventListener('click', closeSheet);

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.id = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `
    <div class="sheet__grip"></div>
    <div class="sheet__head">
      <h2>${esc(title)}</h2>
      <button type="button" class="row__btn" id="sheetClose"
              aria-label="${esc(t('common.close'))}">${icon('x')}</button>
    </div>
    ${body}`;

  document.body.append(scrim, sheet);
  document.body.style.overflow = 'hidden';
  $('#sheetClose').addEventListener('click', closeSheet);
  document.addEventListener('keydown', onSheetKey);

  onMount?.(sheet);
  // Focus the first real control, not the close button.
  (sheet.querySelector('input, select, button:not(#sheetClose)') || sheet).focus();
}

function onSheetKey(e) {
  if (e.key === 'Escape') { closeSheet(); return; }
  if (e.key !== 'Tab') return;
  // Keep tab focus inside the dialog.
  const f = $$('button, input, select, [href], [tabindex]:not([tabindex="-1"])', $('#sheet'))
            .filter(el => !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function closeSheet() {
  $('#sheet')?.remove();
  $('#scrim')?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onSheetKey);
  lastFocused?.focus();
  lastFocused = null;
}

/** Shared numeric-field validator. Shows the error under the field. */
function readNumber(input, { min, max, required = true }) {
  const errEl = $(`#${input.id}-err`);
  const raw = input.value.trim();
  const fail = msg => {
    input.setAttribute('aria-invalid', 'true');
    if (errEl) errEl.innerHTML = `${icon('alert')}<span>${esc(msg)}</span>`;
    return null;
  };
  if (!raw) return required ? fail(t('common.required')) : undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fail(t('common.errNumber'));
  if (n < min || n > max) return fail(t('common.errRange'));
  input.removeAttribute('aria-invalid');
  if (errEl) errEl.innerHTML = '';
  return n;
}

/* ===================================================================
   Sheets: weight, drink, session
   =================================================================== */

function sheetWeight() {
  const cur = S.todayWeight();
  openSheet({
    title: t('weight.entryTitle'),
    body: `
      <div class="field">
        <label for="wKg">${esc(t('weight.entryTitle'))} <span class="req">*</span></label>
        <input class="input input--big" id="wKg" type="number" inputmode="decimal"
               step="0.1" min="20" max="250" value="${cur ? cur.kg : ''}"
               autocomplete="off" enterkeyhint="done">
        <div class="err" id="wKg-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('weight.hint'))}</p>
      </div>
      <button type="button" class="btn btn--primary" id="wSave">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>`,
    onMount(sheet) {
      const input = $('#wKg', sheet);
      const save = () => {
        const kg = readNumber(input, { min: 20, max: 250 });
        if (kg == null) { input.focus(); return; }
        S.logWeight(kg);
        closeSheet();
        toast(t('settings.saved'));
      };
      $('#wSave', sheet).addEventListener('click', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    }
  });
}

const DRINKS = [
  { key: 'fluid.glass',  ml: 250, icon: 'glass'  },
  { key: 'fluid.cup',    ml: 200, icon: 'cup'    },
  { key: 'fluid.bottle', ml: 500, icon: 'bottle' },
  { key: 'fluid.other',  ml: 0,   icon: 'plus'   }
];

/* Fluid that arrives as food. Patients log drinks honestly and still turn up
   overloaded because sabaw, lugaw and ice never felt like "drinking".
   Volumes are per typical serving. */
const FOODS = [
  { key: 'fluid.sabaw', ml: 240, icon: 'bowl'  },   // 1 cup of soup
  { key: 'fluid.lugaw', ml: 300, icon: 'bowl'  },   // 1 bowl
  { key: 'fluid.kape',  ml: 150, icon: 'cup'   },   // 1 cup
  { key: 'fluid.yelo',  ml: 120, icon: 'ice'   }    // 1 cup of ice, melted
];

function addDrink(ml, labelKey) {
  const entry = S.logIntake(ml, labelKey);
  toast(`${t('fluid.added')} ${ml} ${t('common.ml')}`, t('common.undo'), () => {
    S.deleteIntake(entry.id);
    toast(t('fluid.removed'));
  });
}

function sheetCustomDrink() {
  openSheet({
    title: t('fluid.customTitle'),
    body: `
      <div class="field">
        <label for="dMl">${esc(t('common.ml'))} <span class="req">*</span></label>
        <input class="input input--big" id="dMl" type="number" inputmode="numeric"
               step="10" min="10" max="3000" autocomplete="off" enterkeyhint="done">
        <div class="err" id="dMl-err" role="alert" aria-live="polite"></div>
      </div>
      <button type="button" class="btn btn--primary" id="dSave">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>`,
    onMount(sheet) {
      const input = $('#dMl', sheet);
      const save = () => {
        const ml = readNumber(input, { min: 10, max: 3000 });
        if (ml == null) { input.focus(); return; }
        closeSheet();
        addDrink(ml, 'fluid.other');
      };
      $('#dSave', sheet).addEventListener('click', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    }
  });
}

function sheetHdBp() {
  openSheet({
    title: t('hdbp.sheetTitle'),
    body: `
      <div class="field-row">
        <div class="field">
          <label for="hSys">${esc(t('hdbp.sys'))} <span class="req">*</span></label>
          <input class="input input--big" id="hSys" type="number" inputmode="numeric"
                 placeholder="120" min="50" max="260" autocomplete="off">
          <div class="err" id="hSys-err" role="alert" aria-live="polite"></div>
        </div>
        <div class="field">
          <label for="hDia">${esc(t('hdbp.dia'))} <span class="req">*</span></label>
          <input class="input input--big" id="hDia" type="number" inputmode="numeric"
                 placeholder="80" min="30" max="180" autocomplete="off">
          <div class="err" id="hDia-err" role="alert" aria-live="polite"></div>
        </div>
      </div>
      <div class="field">
        <label for="hPulse">${esc(t('hdbp.pulse'))}</label>
        <input class="input" id="hPulse" type="number" inputmode="numeric"
               placeholder="72" min="30" max="220" autocomplete="off">
        <div class="err" id="hPulse-err" role="alert" aria-live="polite"></div>
      </div>
      <div class="field">
        <label for="hNote">${esc(t('hdbp.note'))}</label>
        <input class="input" id="hNote" type="text" maxlength="200" autocomplete="off">
      </div>
      <button type="button" class="btn btn--primary" id="hSave">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>`,
    onMount(sheet) {
      const save = () => {
        const sys = readNumber($('#hSys', sheet), { min: 50, max: 260 });
        if (sys == null) { $('#hSys', sheet).focus(); return; }
        const dia = readNumber($('#hDia', sheet), { min: 30, max: 180 });
        if (dia == null) { $('#hDia', sheet).focus(); return; }
        const pulse = readNumber($('#hPulse', sheet), { min: 30, max: 220, required: false });
        if (pulse === null) { $('#hPulse', sheet).focus(); return; }
        const note = $('#hNote', sheet).value.trim();

        const entry = S.logHdBp({ sys, dia, pulse: pulse ?? null, note });
        closeSheet();
        if (S.isLowSys(entry.sys)) toast(t('hdbp.lowAdvice'));
        else toast(t('hdbp.saved'));
      };
      $('#hSave', sheet).addEventListener('click', save);
      sheet.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    }
  });
}

function hdBpCard() {
  const list = S.todayHdBp();
  return `
  <h2 class="section-title">${esc(t('hdbp.title'))}</h2>
  <div class="card">
    <p class="hint" style="margin-top:0">${esc(t('hdbp.hint'))}</p>
    ${list.length ? `<ul>${list.map(r => {
      const low = S.isLowSys(r.sys);
      return `
      <li class="row">
        <span class="row__icon">${icon('heart-pulse')}</span>
        <span class="row__body">
          <span class="row__title">
            ${r.sys}/${r.dia}${r.pulse != null ? ` · ${r.pulse} bpm` : ''}
            ${low ? `<span class="med-tag med-tag--hold">${esc(t('hdbp.low'))}</span>` : ''}
          </span>
          <span class="row__sub">${esc(fmtTime(r.ts))}${r.note ? ` · ${esc(r.note)}` : ''}</span>
        </span>
        <button type="button" class="row__btn" data-del-hdbp="${r.id}"
                aria-label="${esc(t('common.delete'))} ${r.sys}/${r.dia}">${icon('trash')}</button>
      </li>`;
    }).join('')}</ul>`
      : `<div class="empty">${icon('heart-pulse')}<p>${esc(t('hdbp.empty'))}</p></div>`}
    <button type="button" class="btn btn--ghost" id="btnLogHdBp" style="width:100%;margin-top:var(--s-3)">
      ${icon('plus')}<span>${esc(t('hdbp.addBtn'))}</span>
    </button>
  </div>`;
}

function sheetSession() {
  openSheet({
    title: t('session.sheetTitle'),
    body: `
      <div class="field">
        <label for="sPost">${esc(t('session.postKg'))} <span class="req">*</span></label>
        <input class="input input--big" id="sPost" type="number" inputmode="decimal"
               step="0.1" min="20" max="250" autocomplete="off">
        <div class="err" id="sPost-err" role="alert" aria-live="polite"></div>
      </div>
      <div class="field">
        <label for="sPre">${esc(t('session.preKg'))}</label>
        <input class="input" id="sPre" type="number" inputmode="decimal"
               step="0.1" min="20" max="250" autocomplete="off">
        <div class="err" id="sPre-err" role="alert" aria-live="polite"></div>
      </div>
      <div class="field">
        <label for="sUf">${esc(t('session.uf'))}</label>
        <input class="input" id="sUf" type="number" inputmode="decimal"
               step="0.1" min="0" max="8" autocomplete="off">
        <div class="err" id="sUf-err" role="alert" aria-live="polite"></div>
      </div>
      <div class="field">
        <label for="sSys">${esc(t('session.bp'))}</label>
        <div class="field-row">
          <input class="input" id="sSys" type="number" inputmode="numeric"
                 placeholder="120" min="50" max="260" autocomplete="off"
                 aria-label="Systolic">
          <input class="input" id="sDia" type="number" inputmode="numeric"
                 placeholder="80" min="30" max="180" autocomplete="off"
                 aria-label="Diastolic">
        </div>
        <div class="err" id="sSys-err" role="alert" aria-live="polite"></div>
      </div>
      <button type="button" class="btn btn--primary" id="sSave">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>`,
    onMount(sheet) {
      $('#sSave', sheet).addEventListener('click', () => {
        const post = readNumber($('#sPost', sheet), { min: 20, max: 250 });
        if (post == null) { $('#sPost', sheet).focus(); return; }
        const pre = readNumber($('#sPre', sheet), { min: 20, max: 250, required: false });
        if (pre === null) { $('#sPre', sheet).focus(); return; }
        const uf  = readNumber($('#sUf', sheet),  { min: 0,  max: 8,   required: false });
        if (uf === null) { $('#sUf', sheet).focus(); return; }
        const sys = readNumber($('#sSys', sheet), { min: 50, max: 260, required: false });
        if (sys === null) { $('#sSys', sheet).focus(); return; }
        const dia = readNumber($('#sDia', sheet), { min: 30, max: 180, required: false });
        if (dia === null) { $('#sDia', sheet).focus(); return; }

        S.logSession({ postKg: post, preKg: pre ?? null, ufL: uf ?? null,
                       bpSys: sys ?? null, bpDia: dia ?? null });
        closeSheet();
        toast(t('session.saved'));
      });
    }
  });
}

function sheetCalibrate() {
  const last = S.lastSession();
  if (!last) { toast(t('scale.needSession')); return; }

  openSheet({
    title: t('scale.calibrate'),
    body: `
      <p class="banner">${icon('info')}<span>${esc(t('scale.why'))}</span></p>
      <div class="field">
        <label>${esc(t('scale.step1'))}</label>
        <p class="status__num tnum" style="font-size:var(--t-xl);text-align:center;margin:0">
          ${nf(last.postKg, 1)}<span class="status__unit"> ${esc(t('common.kg'))}</span>
        </p>
        <p class="hint" style="text-align:center">${esc(fmtDate(last.ts))}</p>
      </div>
      <div class="field">
        <label for="cHome">${esc(t('scale.step2'))} <span class="req">*</span></label>
        <input class="input input--big" id="cHome" type="number" inputmode="decimal"
               step="0.1" min="20" max="250" autocomplete="off" enterkeyhint="done">
        <div class="err" id="cHome-err" role="alert" aria-live="polite"></div>
      </div>
      <button type="button" class="btn btn--primary" id="cSave">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>`,
    onMount(sheet) {
      const input = $('#cHome', sheet);
      const save = () => {
        const home = readNumber(input, { min: 20, max: 250 });
        if (home == null) { input.focus(); return; }
        S.setScaleOffset(home, last.postKg);
        closeSheet();
        toast(t('settings.saved'));
      };
      $('#cSave', sheet).addEventListener('click', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    }
  });
}

/* ===================================================================
   View: Today
   =================================================================== */

function statusCard() {
  const w = S.todayWeight();
  const last = S.lastSession();

  if (!last) return emptyStatus('today.noBaseline', 'today.noBaselineMsg', 'session');
  if (!w)    return emptyStatus('today.noWeight',   'today.noWeightMsg',   'weigh');

  const gain  = S.idwgKg();
  const limit = S.effectiveLimitKg();
  const b     = S.band();
  const gap   = S.gapDays();
  const pct   = Math.min(100, Math.max(0, (gain / limit) * 100));
  const badge = { ok: 'check-circle', warn: 'alert', danger: 'alert-octagon' }[b];

  const advice = b === 'danger' ? t('band.dangerAdvice')
               : b === 'warn'   ? t('band.warnAdvice')
               : null;

  return `
  <section class="status status--${b}" aria-labelledby="statusMsg">
    <p class="status__badge">${icon(badge)}<span>${esc(t('band.' + b))}</span></p>

    <p class="status__num tnum">
      ${gain > 0 ? '+' : ''}${nf(gain, 1)}<span class="status__unit"> ${esc(t('common.kg'))}</span>
    </p>
    <p class="status__label">${esc(t('today.gainLabel'))}${gap ? ` · ${gap}d` : ''}</p>

    <div class="meter meter--${b}">
      <div class="meter__track">
        <div class="meter__fill" style="width:${pct}%"
             role="progressbar" aria-valuenow="${nf(gain, 1)}" aria-valuemin="0"
             aria-valuemax="${nf(limit, 1)}"
             aria-label="${esc(t('today.gainLabel'))}"></div>
      </div>
      <p class="meter__scale">
        <span>0 kg</span>
        <span class="tnum">${esc(t('today.limitLabel'))}: ${nf(limit, 1)} kg</span>
      </p>
    </div>

    <p class="status__msg" id="statusMsg">${esc(t('band.' + b + 'Msg'))}</p>
    ${advice ? `<p class="status__advice">${icon('info')}<span>${esc(advice)}</span></p>` : ''}
  </section>`;
}

/** action is 'session' or 'weigh' — resolved by the delegated click handler. */
function emptyStatus(titleKey, msgKey, action) {
  const label = action === 'session' ? t('session.addBtn') : t('today.weighBtn');
  return `
  <section class="status status--empty">
    <p class="status__badge">${icon('info')}<span>${esc(t(titleKey))}</span></p>
    <p class="status__msg">${esc(t(msgKey))}</p>
    <div style="margin-top:var(--s-4)">
      <button type="button" class="btn btn--primary" data-empty-action="${action}">
        ${icon('plus')}<span>${esc(label)}</span>
      </button>
    </div>
  </section>`;
}

function fluidLine() {
  const left = S.fluidLeftMl();
  if (left == null) return '';
  const glasses = S.glassesLeft();
  const over = left < 0;
  return `
  <div class="card">
    <div class="card__head">${icon('droplet')}<h2>${esc(t('fluid.title'))}</h2></div>
    <div class="stats">
      <div class="stat">
        <span class="stat__val tnum" style="color:${over ? 'var(--danger)' : 'inherit'}">
          ${Math.abs(left)}<small> ${esc(t('common.ml'))}</small>
        </span>
        <p class="stat__key">${esc(over ? t('fluid.over') : t('fluid.left'))}</p>
      </div>
      <div class="stat">
        <span class="stat__val tnum">${S.todayIntakeMl()}<small> ${esc(t('common.ml'))}</small></span>
        <p class="stat__key">${esc(t('fluid.logTitle'))}</p>
      </div>
    </div>
    <p class="status__msg" style="margin-top:var(--s-4);font-size:var(--t-lg)">
      ${over || glasses === 0
        ? esc(t('fluid.noneLeft'))
        : `<strong class="tnum">${glasses}</strong> ${esc(glassWord(glasses))}`}
    </p>
  </div>`;
}

function tiles(list) {
  return `<div class="drinks">
    ${list.map(d => `
      <button type="button" class="drink" data-ml="${d.ml}" data-key="${d.key}">
        ${icon(d.icon)}
        <span class="drink__name">${esc(t(d.key))}</span>
        <span class="drink__ml tnum">${d.ml ? d.ml + ' ' + t('common.ml') : '—'}</span>
      </button>`).join('')}
  </div>`;
}

function drinkGrid() {
  return `
  <h2 class="section-title">${esc(t('fluid.drinkTitle'))}</h2>
  ${tiles(DRINKS)}
  <h2 class="section-title">${esc(t('fluid.foodTitle'))}</h2>
  <p class="banner">${icon('info')}<span>${esc(t('fluid.foodHint'))}</span></p>
  ${tiles(FOODS)}`;
}

/** "Today" / "Tomorrow" / "N days from now" — the forward-looking twin
    of relDay(), which only handles dates already in the past. */
function nextHdLabel() {
  const next = S.nextSessionDate();
  if (!next) return '—';
  const days = S.daysBetween(S.dayKey(), S.dayKey(next));
  if (days === 0) return t('session.today');
  if (days === 1) return t('reminder.tomorrow');
  return `${days} ${t('reminder.daysFromNow')}`;
}

/** A tappable summary card. `go` is a view name — clicking it hands off
    to the tab that owns the actual feature, via the router's existing
    [data-go] handling. `big` may carry pre-built markup (tnum spans),
    so it is not escaped here; callers are responsible for esc()ing any
    raw text before interpolating it in. */
function reminderCard({ go, iconName, tone, title, big, sub, tile = false }) {
  if (tile) {
    return `
    <button type="button" class="reminder reminder--tile" data-go="${go}">
      <span class="reminder__icon${tone ? ` reminder__icon--${tone}` : ''}">${icon(iconName)}</span>
      <span class="reminder__title">${esc(title)}</span>
      <span class="reminder__big">${big}</span>
      ${sub ? `<span class="reminder__sub">${esc(sub)}</span>` : ''}
    </button>`;
  }
  return `
  <button type="button" class="reminder" data-go="${go}">
    <span class="reminder__icon${tone ? ` reminder__icon--${tone}` : ''}">${icon(iconName)}</span>
    <span class="reminder__body">
      <span class="reminder__title">${esc(title)}</span>
      <span class="reminder__big">${big}</span>
      ${sub ? `<span class="reminder__sub">${esc(sub)}</span>` : ''}
    </span>
    ${icon('chevron-right', 'reminder__chev')}
  </button>`;
}

function fluidReminder() {
  const left = S.fluidLeftMl();
  const consumed = S.todayIntakeMl();
  if (left == null) {
    return reminderCard({
      go: 'fluid', iconName: 'droplet', title: t('fluid.title'),
      big: `${consumed}<small style="font-size:var(--t-sm);font-weight:600;color:var(--fg-muted)"> ${esc(t('common.ml'))}</small>`,
      sub: t('fluid.logTitle'), tile: true
    });
  }
  const over = left < 0;
  const glasses = S.glassesLeft();
  return reminderCard({
    go: 'fluid', iconName: 'droplet', tone: over ? 'danger' : undefined,
    title: t('fluid.title'),
    big: `${consumed}<small style="font-size:var(--t-sm);font-weight:600;color:var(--fg-muted)"> / ${S.getProfile().allowanceMl} ${esc(t('common.ml'))}</small>`,
    sub: over ? t('fluid.noneLeft')
              : `${glasses} ${esc(glassWord(glasses))}`,
    tile: true
  });
}

function weightReminder() {
  const w = S.todayWeight();
  return reminderCard({
    go: 'weight', iconName: 'scale',
    title: t('weight.entryTitle'),
    big: w
      ? `${nf(w.kg, 1)}<small style="font-size:var(--t-sm);font-weight:600;color:var(--fg-muted)"> ${esc(t('common.kg'))}</small>`
      : `<span style="font-size:var(--t-md);color:var(--fg-muted)">—</span>`,
    sub: w ? undefined : t('reminder.notWeighedYet'),
    tile: true
  });
}

function nextHdReminder() {
  const p = S.getProfile();
  return reminderCard({
    go: 'session', iconName: 'calendar',
    title: t('session.nextDue'),
    big: esc(nextHdLabel()),
    sub: `${p.schedule} · ${p.sessionTime}${p.stationNo ? ` · Station ${p.stationNo}` : ''}`
  });
}

/* ---------- Today: trend charts ----------
   One small chart per other tab (Fluid, Weight, Meds, Dialysis) so Today
   is a dashboard of the whole app, not just the gain number. Every chart
   is a plain SVG built by hand — same offline-first rule as sparkline()
   below — and every card is tappable straight through to the tab that
   owns the real data (data-go, handled by the existing router). */

function miniBars(values, { refValue, dangerAbove } = {}) {
  const n = values.length;
  if (n < 2) return '';
  const W = 320, H = 96, PAD = 8, gap = 6;
  const top = Math.max(...values, refValue || 0, 1) * 1.08;
  const barW = (W - PAD * 2 - gap * (n - 1)) / n;
  const y = v => H - PAD - (v / top) * (H - PAD * 2);
  const bars = values.map((v, i) => {
    const yTop = y(v);
    const h = Math.max(2, (H - PAD) - yTop);
    const x = PAD + i * (barW + gap);
    const over = dangerAbove != null && v > dangerAbove;
    return `<rect class="bar${over ? ' bar--danger' : ''}"
              x="${x.toFixed(1)}" y="${yTop.toFixed(1)}"
              width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>`;
  }).join('');
  const ref = refValue != null
    ? `<line class="spark__dry" x1="${PAD}" y1="${y(refValue).toFixed(1)}"
             x2="${W - PAD}" y2="${y(refValue).toFixed(1)}"/>`
    : '';
  return `<svg class="minibars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
       role="img" aria-label="${n} bars, most recent ${nf(values[values.length - 1], 0)}">
    ${ref}${bars}
  </svg>`;
}

function fluidWeekChart() {
  const p = S.getProfile();
  const all = S.getIntake();
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); return S.dayKey(d);
  });
  const totals = days.map(key => all.filter(x => x.day === key).reduce((sum, x) => sum + x.ml, 0));
  if (totals.filter(v => v > 0).length < 2) return '';
  return `
  <button type="button" class="card chart-card" data-go="fluid">
    <div class="card__head">${icon('droplet')}<h2>${esc(t('fluid.title'))}</h2></div>
    ${miniBars(totals, { refValue: p.allowanceMl, dangerAbove: p.allowanceMl })}
    <div class="chart-legend">
      <span><i style="background:var(--brand)"></i>${esc(t('fluid.logTitle'))}</span>
      <span><i style="background:var(--fg-muted)"></i>${esc(t('today.limitLabel'))}: ${p.allowanceMl} ${esc(t('common.ml'))}</span>
    </div>
  </button>`;
}

function weightTrendChart() {
  const p = S.getProfile();
  const recent = S.getWeights().slice(0, 14);
  if (recent.length < 2) return '';
  return `
  <button type="button" class="card chart-card" data-go="weight">
    <div class="card__head">${icon('trending')}<h2>${esc(t('weight.chartTitle'))}</h2></div>
    ${sparkline(recent, p.dryWeightKg)}
  </button>`;
}

function medsTodayChart() {
  const meds = S.getMedications().filter(m => m.active !== false);
  if (!meds.length) return '';
  const logs = S.todayMedLogs();
  const taken = meds.filter(m => logs[`${m.id}_default`]).length;
  const pct = Math.round((taken / meds.length) * 100);
  return `
  <button type="button" class="card chart-card" data-go="meds">
    <div class="card__head">${icon('pill')}<h2>${esc(t('meds.title'))}</h2></div>
    <div class="meter meter--brand">
      <div class="meter__track">
        <div class="meter__fill" style="width:${pct}%" role="progressbar"
             aria-valuenow="${taken}" aria-valuemin="0" aria-valuemax="${meds.length}"
             aria-label="${esc(t('meds.title'))}"></div>
      </div>
      <p class="meter__scale">
        <span class="tnum">${taken} / ${meds.length} ${esc(t('meds.taken'))}</span>
        <span class="tnum">${pct}%</span>
      </p>
    </div>
  </button>`;
}

function sessionUfChart() {
  const values = S.getSessions().slice(0, 6).reverse()
    .map(s => s.ufL).filter(v => v != null);
  if (values.length < 2) return '';
  return `
  <button type="button" class="card chart-card" data-go="session">
    <div class="card__head">${icon('activity')}<h2>${esc(t('session.title'))}</h2></div>
    ${miniBars(values, {})}
    <div class="chart-legend">
      <span><i style="background:var(--brand)"></i>${esc(t('session.uf'))}</span>
    </div>
  </button>`;
}

/** Month calendar: dialysis days tinted, today ringed, logged sessions
    dotted. Read-only overview — only the month-nav arrows are tappable,
    so there's no ambiguity about what tapping a past/future day would
    do. calCursor is module state so prev/next survives re-render. */
function calendarCard() {
  const schedDays = S.scheduleDays();
  const sessionDays = new Set(S.getSessions().map(s => s.day));
  const todayKey = S.dayKey();

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthLabel = new Intl.DateTimeFormat(localeTag(), { month: 'long', year: 'numeric' }).format(first);
  // 2023-01-01 is a Sunday — just a stable anchor to read Sun..Sat labels off of.
  const weekdayFmt = new Intl.DateTimeFormat(localeTag(), { weekday: 'narrow' });
  const heads = [...Array(7)].map((_, i) =>
    `<span>${esc(weekdayFmt.format(new Date(2023, 0, 1 + i)))}</span>`).join('');

  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cal__cell cal__cell--pad"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const key = S.dayKey(date);
    const cls = ['cal__cell',
      schedDays.includes(date.getDay()) ? 'cal__cell--sched' : '',
      key === todayKey ? 'cal__cell--today' : ''
    ].filter(Boolean).join(' ');
    cells.push(`<span class="${cls}">${d}${sessionDays.has(key) ? '<i class="cal__dot"></i>' : ''}</span>`);
  }

  return `
  <div class="card">
    <div class="cal__head">
      <h2>${esc(monthLabel)}</h2>
      <div class="cal__nav">
        <button type="button" class="cal__navbtn" data-cal-nav="-1" aria-label="${esc(t('common.prevMonth'))}">
          ${icon('chevron-right', 'cal__navicon--prev')}
        </button>
        <button type="button" class="cal__navbtn" data-cal-nav="1" aria-label="${esc(t('common.nextMonth'))}">
          ${icon('chevron-right')}
        </button>
      </div>
    </div>
    <div class="cal__grid cal__grid--head">${heads}</div>
    <div class="cal__grid">${cells.join('')}</div>
    <div class="chart-legend">
      <span><i style="background:var(--brand-tint-2)"></i>${esc(t('today.calSchedDay'))}</span>
      <span><i class="chart-legend__dot" style="background:var(--brand-dark)"></i>${esc(t('today.calLogged'))}</span>
    </div>
  </div>`;
}

function trendsSection() {
  const cards = [fluidWeekChart(), weightTrendChart(), medsTodayChart(), sessionUfChart()]
    .filter(Boolean);
  if (!cards.length) return '';
  return `
  <h2 class="section-title">${esc(t('today.trends'))}</h2>
  ${cards.join('')}`;
}

function viewToday() {
  // Uncalibrated scales silently bias every gain figure, so nudge once
  // there is a baseline to calibrate against.
  const nudge = (S.lastSession() && !S.isCalibrated())
    ? `<p class="banner">${icon('alert')}<span>${esc(t('scale.nudge'))}</span>
         <button type="button" class="row__btn" id="btnCalibrate"
                 aria-label="${esc(t('scale.calibrate'))}">${icon('scale')}</button></p>`
    : '';
  // No dialysis logged yet means there is no baseline to show a gain
  // against — that prompt now lives solely on the Dialysis tab (where
  // the "Record a dialysis" action actually is) so it isn't duplicated
  // here. Once a session exists, statusCard() takes over as normal,
  // including its own "weigh in today" empty state.
  const status = S.lastSession() ? statusCard() : '';
  return `
  <div class="view view--today">
    ${nudge}
    ${status}
    <div class="today-grid-2">
      ${fluidReminder()}
      ${weightReminder()}
    </div>
    ${nextHdReminder()}
    ${calendarCard()}
    ${trendsSection()}
  </div>`;
}

/* ===================================================================
   View: Fluid
   =================================================================== */

function viewFluid() {
  const list = S.todayIntake();
  return `
  <div class="view">
    ${fluidLine()}
    ${drinkGrid()}
    <h2 class="section-title">${esc(t('fluid.logTitle'))}</h2>
    <div class="card">
      ${list.length ? `<ul>${list.map(i => `
        <li class="row">
          <span class="row__icon">${icon('droplet')}</span>
          <span class="row__body">
            <span class="row__title">${esc(t(i.labelKey))}</span>
            <span class="row__sub">${esc(fmtTime(i.ts))}</span>
          </span>
          <span class="row__val tnum">${i.ml} ${esc(t('common.ml'))}</span>
          <button type="button" class="row__btn" data-del-intake="${i.id}"
                  aria-label="${esc(t('common.delete'))} ${i.ml} ${esc(t('common.ml'))}">
            ${icon('trash')}
          </button>
        </li>`).join('')}</ul>`
        : `<div class="empty">${icon('droplet')}<p>${esc(t('fluid.empty'))}</p></div>`}
    </div>
  </div>`;
}

/* ===================================================================
   View: Weight  (SVG sparkline, no chart library — must work offline)
   =================================================================== */

function sparkline(weights, dryKg) {
  if (weights.length < 2) return '';
  const pts = [...weights].reverse();               // oldest → newest
  const W = 320, H = 120, PAD = 8;
  const vals = pts.map(p => p.kg).concat(dryKg ? [dryKg] : []);
  const min = Math.min(...vals) - 0.5;
  const max = Math.max(...vals) + 0.5;
  const span = (max - min) || 1;

  const x = i => PAD + (i * (W - PAD * 2)) / (pts.length - 1);
  const y = v => PAD + (H - PAD * 2) * (1 - (v - min) / span);

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) =>
    `<circle class="spark__dot" cx="${x(i).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="3.5"/>`).join('');
  const dry = dryKg
    ? `<line class="spark__dry" x1="${PAD}" y1="${y(dryKg).toFixed(1)}"
             x2="${W - PAD}" y2="${y(dryKg).toFixed(1)}"/>` : '';

  return `
  <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
       role="img" aria-label="${esc(t('weight.chartTitle'))}: ${pts.length} points,
       ${nf(min + 0.5, 1)}–${nf(max - 0.5, 1)} kg">
    <line class="spark__grid" x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}"/>
    ${dry}
    <path class="spark__line" d="${line}"/>
    ${dots}
  </svg>
  <div class="chart-legend">
    <span><i style="background:var(--brand)"></i>${esc(t('weight.title'))}</span>
    ${dryKg ? `<span><i style="background:var(--fg-muted)"></i>${esc(t('weight.dryLine'))} ${nf(dryKg, 1)} kg</span>` : ''}
  </div>`;
}

function viewWeight() {
  const p = S.getProfile();
  const all = S.getWeights();
  const recent = all.slice(0, 14);
  return `
  <div class="view">
    <div class="card">
      <div class="card__head">${icon('trending')}<h2>${esc(t('weight.chartTitle'))}</h2></div>
      ${recent.length >= 2
        ? sparkline(recent, p.dryWeightKg)
        : `<div class="empty">${icon('trending')}<p>${esc(t('weight.empty'))}</p></div>`}
    </div>

    <button type="button" class="btn btn--primary" id="btnWeigh">
      ${icon('plus')}<span>${esc(t('today.weighBtn'))}</span>
    </button>

    <h2 class="section-title">${esc(t('weight.tableTitle'))}</h2>
    <div class="card">
      ${all.length ? `<ul>${all.slice(0, 30).map(w => {
        const diff = p.dryWeightKg ? w.kg - p.dryWeightKg : null;
        return `
        <li class="row">
          <span class="row__icon">${icon('scale')}</span>
          <span class="row__body">
            <span class="row__title">${esc(fmtDate(w.ts))}</span>
            ${diff != null ? `<span class="row__sub tnum">${diff > 0 ? '+' : ''}${nf(diff, 1)} kg vs dry weight</span>` : ''}
          </span>
          <span class="row__val tnum">${nf(w.kg, 1)} ${esc(t('common.kg'))}</span>
          <button type="button" class="row__btn" data-del-weight="${w.id}"
                  aria-label="${esc(t('common.delete'))} ${esc(fmtDate(w.ts))}">${icon('trash')}</button>
        </li>`; }).join('')}</ul>`
        : `<div class="empty">${icon('scale')}<p>${esc(t('weight.empty'))}</p></div>`}
    </div>
  </div>`;
}

/* ===================================================================
   View: Medications
   =================================================================== */

function viewMeds() {
  const meds = S.getMedications();
  const logs = S.todayMedLogs();
  const activeMeds = meds.filter(m => m.active !== false);

  const categories = [
    { id: 'meals', title: t('meds.meals'), icon: 'cup' },
    { id: 'morning', title: t('meds.morning'), icon: 'sun' },
    { id: 'afternoon', title: t('meds.afternoon'), icon: 'sun' },
    { id: 'evening', title: t('meds.evening'), icon: 'pill' },
    { id: 'bedtime', title: t('meds.bedtime'), icon: 'pill' },
    { id: 'dialysis_days', title: t('meds.dialysisDays'), icon: 'activity' }
  ];

  return `
  <div class="view">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s-4)">
      <h2 style="font-size:var(--t-xl);margin:0">${esc(t('meds.title'))}</h2>
      <button type="button" class="btn btn--primary" id="btnAddMed">
        ${icon('plus')}<span>${esc(t('meds.addBtn'))}</span>
      </button>
    </div>

    ${activeMeds.length ? categories.map(cat => {
      const catMeds = activeMeds.filter(m => m.timing === cat.id);
      if (!catMeds.length) return '';
      return `
        <h3 class="section-title">${esc(cat.title)}</h3>
        ${catMeds.map(m => {
          const takenKey = `${m.id}_default`;
          const taken = !!logs[takenKey];
          return `
          <div class="med-row ${taken ? 'med-row--taken' : ''}">
            <div class="med-row__info">
              <div class="med-row__title">${esc(m.name)}</div>
              <div class="med-row__dose">${esc(m.dose)}</div>
              ${m.notes ? `<div class="med-row__notes">${esc(m.notes)}</div>` : ''}
              ${m.holdOnDialysis ? `<span class="med-tag med-tag--hold">${esc(t('meds.holdAlert'))}</span>` : ''}
            </div>
            <button type="button" class="med-check-btn" data-toggle-med="${m.id}" aria-label="Toggle taken">
              ${taken ? icon('check') : ''}
            </button>
            <button type="button" class="row__btn" data-edit-med="${m.id}" aria-label="Edit medication">
              ${icon('edit')}
            </button>
          </div>`;
        }).join('')}`;
    }).join('') : `<div class="empty">${icon('pill')}<p>${esc(t('meds.empty'))}</p></div>`}
  </div>`;
}

function sheetMedication(medId) {
  const list = S.getMedications();
  const cur = medId ? list.find(m => m.id === medId) : null;

  openSheet({
    title: cur ? t('meds.sheetTitle') : t('meds.addBtn'),
    body: `
      <div class="form-group">
        <label for="mName">${esc(t('meds.name'))} <span class="req">*</span></label>
        <input class="input" id="mName" type="text" value="${esc(cur ? cur.name : '')}" placeholder="e.g. Calcium Carbonate">
      </div>
      <div class="form-group">
        <label for="mDose">${esc(t('meds.dose'))} <span class="req">*</span></label>
        <input class="input" id="mDose" type="text" value="${esc(cur ? cur.dose : '')}" placeholder="e.g. 500mg (1 tablet)">
      </div>
      <div class="form-group">
        <label for="mTiming">${esc(t('meds.timing'))}</label>
        <select class="input" id="mTiming">
          <option value="meals" ${cur?.timing === 'meals' ? 'selected' : ''}>${esc(t('meds.meals'))}</option>
          <option value="morning" ${cur?.timing === 'morning' ? 'selected' : ''}>${esc(t('meds.morning'))}</option>
          <option value="afternoon" ${cur?.timing === 'afternoon' ? 'selected' : ''}>${esc(t('meds.afternoon'))}</option>
          <option value="evening" ${cur?.timing === 'evening' ? 'selected' : ''}>${esc(t('meds.evening'))}</option>
          <option value="bedtime" ${cur?.timing === 'bedtime' ? 'selected' : ''}>${esc(t('meds.bedtime'))}</option>
          <option value="dialysis_days" ${cur?.timing === 'dialysis_days' ? 'selected' : ''}>${esc(t('meds.dialysisDays'))}</option>
        </select>
      </div>
      <div class="form-group">
        <label for="mNotes">${esc(t('meds.notes'))}</label>
        <input class="input" id="mNotes" type="text" value="${esc(cur ? cur.notes : '')}" placeholder="e.g. Take with first bite of food">
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:var(--s-2)">
        <input type="checkbox" id="mHold" ${cur?.holdOnDialysis ? 'checked' : ''}>
        <label for="mHold" style="margin:0">${esc(t('meds.holdAlert'))}</label>
      </div>
      <div style="display:flex;gap:var(--s-3)">
        ${cur ? `<button type="button" class="btn btn--danger" id="mDel" style="flex:1">${icon('trash')}<span>${esc(t('common.delete'))}</span></button>` : ''}
        <button type="button" class="btn btn--primary" id="mSave" style="flex:2">${icon('check')}<span>${esc(t('common.save'))}</span></button>
      </div>`,
    onMount(sheet) {
      $('#mSave', sheet).addEventListener('click', () => {
        const name = $('#mName', sheet).value.trim();
        const dose = $('#mDose', sheet).value.trim();
        if (!name || !dose) { toast('Please enter name and dose.'); return; }
        S.saveMedication({
          id: cur ? cur.id : null,
          name,
          dose,
          timing: $('#mTiming', sheet).value,
          notes: $('#mNotes', sheet).value.trim(),
          holdOnDialysis: $('#mHold', sheet).checked,
          active: true
        });
        closeSheet();
        toast(t('settings.saved'));
      });
      if (cur) {
        $('#mDel', sheet)?.addEventListener('click', () => {
          S.deleteMedication(cur.id);
          closeSheet();
          toast(t('common.delete'));
        });
      }
    }
  });
}

/* ===================================================================
   View: Dialysis sessions & Pre-dialysis checklist
   =================================================================== */

function relDay(day) {
  const d = S.daysBetween(day, S.dayKey());
  if (d === 0) return t('session.today');
  if (d === 1) return t('session.yesterday');
  return `${d} ${t('session.daysAgo')}`;
}

function viewSession() {
  const list = S.getSessions();
  const next = S.nextSessionDate();
  const p = S.getProfile();
  const checklist = S.getTodayChecklist();

  return `
  <div class="view">
    ${!list.length ? emptyStatus('today.noBaseline', 'today.noBaselineMsg', 'session') : ''}
    <div class="card">
      <div class="card__head">${icon('calendar')}<h2>${esc(t('session.nextDue'))}</h2></div>
      <p class="status__num tnum" style="font-size:var(--t-xl);text-align:center">
        ${next ? esc(new Intl.DateTimeFormat(localeTag(),
            { weekday: 'long', day: 'numeric', month: 'long' }).format(next))
          : '—'}
      </p>
      <p class="stat__key" style="text-align:center">
        ${esc(p.schedule)} · Chair Time: ${esc(p.sessionTime)} ${p.stationNo ? `· Station ${esc(p.stationNo)}` : ''}
      </p>
    </div>

    <h2 class="section-title">${esc(t('checklist.title'))}</h2>
    <div class="card">
      ${checklist.map(item => `
        <div class="chk-item ${item.done ? 'chk-item--done' : ''}" data-toggle-chk="${item.id}">
          <div class="chk-box">${item.done ? icon('check') : ''}</div>
          <span>${esc(item.text)}</span>
        </div>
      `).join('')}
    </div>

    ${hdBpCard()}

    <button type="button" class="btn btn--primary" id="btnSession">
      ${icon('plus')}<span>${esc(t('session.addBtn'))}</span>
    </button>

    <h2 class="section-title">${esc(t('session.title'))}</h2>
    <div class="card">
      ${list.length ? `<ul>${list.slice(0, 20).map(s => `
        <li class="row">
          <span class="row__icon">${icon('activity')}</span>
          <span class="row__body">
            <span class="row__title">${esc(fmtDate(s.ts))} · ${esc(relDay(s.day))}</span>
            <span class="row__sub tnum">
              ${esc(t('session.postKg'))} ${nf(s.postKg, 1)} kg${
                s.ufL != null ? ` · UF ${nf(s.ufL, 1)} L` : ''}${
                s.bpSys ? ` · BP ${s.bpSys}/${s.bpDia ?? '—'}` : ''}
            </span>
          </span>
          <button type="button" class="row__btn" data-del-session="${s.id}"
                  aria-label="${esc(t('common.delete'))} ${esc(fmtDate(s.ts))}">${icon('trash')}</button>
        </li>`).join('')}</ul>`
        : `<div class="empty">${icon('activity')}<p>${esc(t('session.empty'))}</p></div>`}
    </div>
  </div>`;
}

/* ===================================================================
   View: Settings
   =================================================================== */

function viewSettings() {
  const p = S.getProfile();
  return `
  <div class="view">
    <p class="settings-intro">SKTI — SPMC Kidney and Transplant Institute, Davao City</p>

    <h2 class="section-title">${esc(t('settings.language'))}</h2>
    <div class="seg" role="group" aria-label="${esc(t('settings.language'))}">
      ${LANGS.map(c => `
        <button type="button" data-lang="${c}"
                aria-pressed="${c === getLang()}">${esc(langName(c))}</button>`).join('')}
    </div>

    <h2 class="section-title">Patient Profile Customization</h2>
    <div class="card">
      <div class="field">
        <label for="pName">Patient Name</label>
        <input class="input" id="pName" type="text" value="${esc(p.name)}" placeholder="e.g. Juan dela Cruz">
      </div>
      <div class="field">
        <label for="pBooklet">SPMC Booklet / Reg #</label>
        <input class="input" id="pBooklet" type="text" value="${esc(p.bookletNo)}" placeholder="e.g. SPMC-12345">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="pDoctor">Nephrologist Doctor</label>
          <input class="input" id="pDoctor" type="text" value="${esc(p.doctorName)}" placeholder="Dr. Santos">
        </div>
        <div class="field">
          <label for="pStation">Station / Machine #</label>
          <input class="input" id="pStation" type="text" value="${esc(p.stationNo)}" placeholder="Machine 8">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="pNurse">Nurse Contact #</label>
          <input class="input" id="pNurse" type="tel" value="${esc(p.nursePhone)}" placeholder="0917...">
        </div>
        <div class="field">
          <label for="pEmerg">Emergency Phone</label>
          <input class="input" id="pEmerg" type="tel" value="${esc(p.emergencyPhone)}" placeholder="0918...">
        </div>
      </div>
    </div>

    <h2 class="section-title">${esc(t('settings.targets'))}</h2>
    <div class="card">
      <div class="field">
        <label for="pDry">${esc(t('settings.dryWeight'))}</label>
        <input class="input" id="pDry" type="number" inputmode="decimal" step="0.1"
               min="20" max="250" value="${p.dryWeightKg ?? ''}">
        <div class="err" id="pDry-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('settings.dryWeightHint'))}</p>
      </div>
      <div class="field">
        <label for="pAllow">${esc(t('settings.allowance'))}</label>
        <input class="input" id="pAllow" type="number" inputmode="numeric" step="50"
               min="200" max="3000" value="${p.allowanceMl ?? ''}">
        <div class="err" id="pAllow-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('settings.allowanceHint'))}</p>
      </div>
      <div class="field">
        <label for="pIdwg">${esc(t('settings.idwg'))}</label>
        <input class="input" id="pIdwg" type="number" inputmode="decimal" step="0.1"
               min="0.5" max="6" value="${p.idwgLimitKg ?? 2}">
        <div class="err" id="pIdwg-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('settings.idwgHint'))}</p>
      </div>
      <div class="field">
        <label>${esc(t('settings.schedule'))}</label>
        <div class="seg" role="group" aria-label="${esc(t('settings.schedule'))}">
          <button type="button" data-sched="MWF" aria-pressed="${p.schedule === 'MWF'}">MWF</button>
          <button type="button" data-sched="TTS" aria-pressed="${p.schedule === 'TTS'}">TTS</button>
          <button type="button" data-sched="CUSTOM" aria-pressed="${p.schedule === 'CUSTOM'}">${esc(t('settings.scheduleCustom'))}</button>
        </div>
        ${p.schedule === 'CUSTOM' ? `
        <p class="hint">${esc(t('settings.scheduleCustomHint'))}</p>
        <div class="seg" role="group" aria-label="${esc(t('settings.scheduleCustom'))}">
          ${[0, 1, 2, 3, 4, 5, 6].map(dow => `
            <button type="button" data-custom-day="${dow}"
                    aria-pressed="${(p.customDays || []).includes(dow)}">${
              esc(new Intl.DateTimeFormat(localeTag(), { weekday: 'narrow' }).format(new Date(2023, 0, 1 + dow)))
            }</button>`).join('')}
        </div>` : ''}
      </div>
      <button type="button" class="btn btn--primary" id="pSave">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>
    </div>

    <h2 class="section-title">${esc(t('scale.title'))}</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">${esc(t('scale.why'))}</p>
      <div class="stats" style="margin-bottom:var(--s-3)">
        <div class="stat">
          <span class="stat__val tnum">${
            p.scaleCalibratedAt
              ? (p.scaleOffsetKg > 0 ? '+' : '') + nf(p.scaleOffsetKg, 1) + '<small> kg</small>'
              : '—'}</span>
          <p class="stat__key">${esc(t('scale.offset'))}</p>
        </div>
        <div class="stat">
          <span class="stat__val" style="font-size:var(--t-md);font-weight:600">${
            p.scaleCalibratedAt ? esc(fmtDate(p.scaleCalibratedAt)) : esc(t('scale.notSet'))}</span>
          <p class="stat__key">${esc(t('scale.title'))}</p>
        </div>
      </div>
      <button type="button" class="btn btn--ghost" id="btnCalibrate" style="width:100%">
        ${icon('scale')}<span>${esc(p.scaleCalibratedAt ? t('scale.recalibrate') : t('scale.calibrate'))}</span>
      </button>
    </div>

    <h2 class="section-title">${esc(t('cal.title'))}</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">${esc(t('cal.hint'))}</p>
      <div class="field-row">
        <div class="field">
          <label for="pSessionTime">${esc(t('cal.sessionTime'))}</label>
          <input class="input" id="pSessionTime" type="time" value="${esc(p.sessionTime)}">
        </div>
        <div class="field">
          <label for="pWeighTime">${esc(t('cal.weighTime'))}</label>
          <input class="input" id="pWeighTime" type="time" value="${esc(p.weighTime)}">
        </div>
      </div>
      <button type="button" class="btn btn--primary" id="btnCalSchedule" style="width:100%">
        ${icon('calendar')}<span>${esc(t('cal.addSchedule'))}</span>
      </button>
      <div style="height:var(--s-3)"></div>
      <button type="button" class="btn btn--ghost" id="btnCalWeigh" style="width:100%">
        ${icon('scale')}<span>${esc(t('cal.addWeighIn'))}</span>
      </button>
      <div style="height:var(--s-3)"></div>
      <button type="button" class="btn btn--ghost" id="btnCalGoogle" style="width:100%">
        ${icon('calendar')}<span>${esc(t('cal.openGoogle'))}</span>
      </button>
      <p class="banner" style="margin-top:var(--s-4)">
        ${icon('info')}<span>${esc(t('cal.howto'))}</span>
      </p>

      <div style="height:var(--s-2)"></div>
      <button type="button" class="btn btn--ghost" id="btnCalSessions" style="width:100%">
        ${icon('download')}<span>${esc(t('cal.addSessions'))}</span>
      </button>
      <p class="banner">${icon('alert')}<span>${esc(t('cal.warnHealth'))}</span></p>
    </div>

    <h2 class="section-title">${esc(t('install.title'))}</h2>
    <div class="card" id="installCard">
      <p class="hint" style="margin-top:0">${esc(t('install.hint'))}</p>
      <button type="button" class="btn btn--primary" id="btnInstall" hidden>
        ${icon('phone')}<span>${esc(t('install.btn'))}</span>
      </button>
      <p class="banner" id="installIos" hidden>
        ${icon('info')}<span>${esc(t('install.ios'))}</span>
      </p>
      <p class="banner" id="installManual" hidden>
        ${icon('info')}<span>${esc(t('install.manual'))}</span>
      </p>
      <p class="banner" id="installDone" hidden>
        ${icon('check-circle')}<span>${esc(t('install.done'))}</span>
      </p>
    </div>

    <h2 class="section-title">${esc(t('settings.theme'))}</h2>
    <div class="seg" role="group" aria-label="${esc(t('settings.theme'))}">
      ${[['auto', 'settings.themeAuto'], ['light', 'settings.themeLight'], ['dark', 'settings.themeDark']]
        .map(([v, k]) => `<button type="button" data-theme-set="${v}"
              aria-pressed="${p.theme === v}">${esc(t(k))}</button>`).join('')}
    </div>

    <h2 class="section-title">${esc(t('settings.data'))}</h2>
    <div class="card">
      <p class="hint" style="margin-top:0">${esc(t('data.backupHint'))}</p>
      <button type="button" class="btn btn--primary" id="btnExport" style="width:100%">
        ${icon('download')}<span>${esc(t('data.backup'))}</span>
      </button>
      <div style="height:var(--s-3)"></div>
      <button type="button" class="btn btn--ghost" id="btnImport" style="width:100%">
        ${icon('upload')}<span>${esc(t('data.restore'))}</span>
      </button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>

      <div class="row" style="margin-top:var(--s-3)">
        <span class="row__icon">${icon('shield')}</span>
        <span class="row__body">
          <span class="row__title">${esc(t('data.persist'))}</span>
          <span class="row__sub" id="persistState">…</span>
        </span>
      </div>
    </div>

    <div class="card">
      <p class="hint" style="margin-top:0">${esc(t('settings.exportHint'))}</p>
      <button type="button" class="btn btn--ghost" id="btnPrint" style="width:100%">
        ${icon('printer')}<span>${esc(t('settings.export'))}</span>
      </button>
      <div style="height:var(--s-3)"></div>
      <button type="button" class="btn btn--danger" id="btnWipe" style="width:100%">
        ${icon('trash')}<span>${esc(t('settings.wipe'))}</span>
      </button>
    </div>

    <p class="banner">${icon('shield')}<span>${esc(t('legal.privacy'))}</span></p>
    <p class="banner">${icon('info')}<span>${esc(t('legal.disclaimer'))}</span></p>
  </div>`;
}

/* ===================================================================
   Nurse summary — printable, no network
   =================================================================== */

function printSummary() {
  const s = S.buildSummary();
  const p = s.profile;
  const w = document.createElement('div');
  w.id = 'printOnly';
  w.innerHTML = `
    <div class="card">
      <h2>${esc(t('settings.export'))} — ${esc(t('app.sub'))}</h2>
      <p class="hint">${esc(new Date().toLocaleString())}</p>
      <ul>
        <li class="row"><span class="row__body">Dry weight</span>
            <span class="row__val tnum">${p.dryWeightKg ?? '—'} kg</span></li>
        <li class="row"><span class="row__body">Daily fluid allowance</span>
            <span class="row__val tnum">${p.allowanceMl ?? '—'} mL</span></li>
        <li class="row"><span class="row__body">Schedule</span>
            <span class="row__val">${esc(p.schedule)}</span></li>
        <li class="row"><span class="row__body">IDWG now (gap ${s.gapDays ?? '—'}d)</span>
            <span class="row__val tnum">${s.idwgKg != null ? nf(s.idwgKg, 1) + ' kg' : '—'}
              / limit ${nf(s.limitKg, 1)} kg</span></li>
        <li class="row"><span class="row__body">Fluid today</span>
            <span class="row__val tnum">${s.todayIntakeMl} mL</span></li>
      </ul>
      <h3 style="margin-top:16px">Weights (last 14)</h3>
      <ul>${s.weights.map(x => `<li class="row"><span class="row__body">${esc(x.day)}</span>
             <span class="row__val tnum">${nf(x.kg, 1)} kg</span></li>`).join('') || '<li>—</li>'}</ul>
      <h3 style="margin-top:16px">Dialysis (last 6)</h3>
      <ul>${s.sessions.map(x => `<li class="row"><span class="row__body">${esc(x.day)}</span>
             <span class="row__val tnum">post ${nf(x.postKg, 1)} kg${
               x.ufL != null ? ` · UF ${nf(x.ufL, 1)} L` : ''}${
               x.bpSys ? ` · BP ${x.bpSys}/${x.bpDia ?? '—'}` : ''}</span></li>`).join('') || '<li>—</li>'}</ul>
      <p class="hint" style="margin-top:16px">${esc(t('legal.disclaimer'))}</p>
    </div>`;
  document.body.appendChild(w);
  window.print();
  setTimeout(() => w.remove(), 500);
}

/* ===================================================================
   Backup / restore / install
   =================================================================== */

function downloadFile(filename, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  downloadFile(S.exportFilename(), 'application/json',
               JSON.stringify(S.exportAll(), null, 2));
  toast(t('data.exported'));
}

/* ---------- Google Calendar ----------
   An .ics file rather than the Calendar API: no OAuth, no Cloud
   project, and nothing leaves the phone until the patient imports it.
   The VALARM in these events is also the only reminder this app can
   produce that survives the app being closed. */

function calFile(name, text) {
  downloadFile(name, 'text/calendar;charset=utf-8', text);
  toast(t('cal.downloaded'));
}

function calSchedule() {
  const p = S.getProfile();
  calFile('sktidvo-dialysis-schedule.ics', Cal.scheduleIcs({
    schedule: p.schedule,
    customDays: p.customDays,
    sessionTime: p.sessionTime,
    summary: t('cal.evDialysis'),
    alarmMinutesBefore: 120,
    alarmText: t('cal.alarmDialysis'),
    from: S.nextSessionDate() || new Date()
  }));
}

function calWeighIn() {
  const p = S.getProfile();
  calFile('sktidvo-weigh-in.ics', Cal.weighInIcs({
    weighTime: p.weighTime,
    summary: t('cal.evWeigh'),
    description: t('cal.evWeighNote'),
    alarmMinutesBefore: 0,
    alarmText: t('cal.evWeigh')
  }));
}

function calSessions() {
  const sessions = S.getSessions();
  if (!sessions.length) { toast(t('cal.noSessions')); return; }
  const p = S.getProfile();
  calFile('sktidvo-dialysis-log.ics', Cal.sessionsIcs({
    sessions,
    sessionTime: p.sessionTime,
    summary: t('cal.evDialysis'),
    labels: { post: t('cal.labelPost'), uf: t('cal.labelUf'), bp: t('cal.labelBp') }
  }));
}

function calOpenGoogle() {
  const p = S.getProfile();
  const next = S.nextSessionDate();
  if (!next) return;
  // Title and time only — this query string travels to Google and lands
  // in browser history, so no weights or blood pressure go in it.
  const url = Cal.googleTemplateUrl({
    title: t('cal.evDialysis'),
    start: Cal.atTime(next, p.sessionTime),
    schedule: p.schedule,
    customDays: p.customDays
  });
  window.open(url, '_blank', 'noopener');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch {
      toast(t('data.badFile'));
      return;
    }
    // Restore overwrites everything, so confirm before touching stored data.
    if (!confirm(t('data.restoreConfirm'))) return;
    try {
      const counts = S.importAll(parsed);
      setLang(S.getProfile().lang);
      applyTheme(S.getProfile().theme);
      render();
      toast(`${t('data.restored')} · ${counts.weights}/${counts.intake}/${counts.sessions}`);
    } catch {
      toast(t('data.badFile'));
    }
  };
  reader.onerror = () => toast(t('data.badFile'));
  reader.readAsText(file);
}

/* Chrome fires beforeinstallprompt once and only if the app is installable.
   Stash it — the button can only be shown while we hold a live event. */
let installPrompt = null;

function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function syncInstallUi() {
  const btn = $('#btnInstall');
  if (!btn) return;                       // not on the settings view
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const done = isStandalone();
  btn.hidden = done || !installPrompt;
  $('#installDone').hidden = !done;
  // iOS never fires beforeinstallprompt; Chrome may not have fired it yet.
  // Always leave one usable route on screen rather than an empty card.
  $('#installIos').hidden = done || !ios || !!installPrompt;
  $('#installManual').hidden = done || ios || !!installPrompt;
}

async function syncPersistUi() {
  const el = $('#persistState');
  if (!el) return;
  const ok = await S.isPersisted();
  el.textContent = ok === true ? t('data.persistOn')
                 : ok === false ? t('data.persistOff')
                 : '—';
}

/* ===================================================================
   Router + delegated events
   =================================================================== */

const VIEWS = {
  today:    { render: viewToday,    title: 'today.title'    },
  fluid:    { render: viewFluid,    title: 'fluid.title'    },
  weight:   { render: viewWeight,   title: 'weight.title'   },
  meds:     { render: viewMeds,     title: 'meds.title'     },
  session:  { render: viewSession,  title: 'session.title'  },
  settings: { render: viewSettings, title: 'settings.title' }
};

function go(name) {
  view = VIEWS[name] ? name : 'today';
  location.hash = '#' + view;
  render();
  // Move SR focus to content on route change, but don't let the browser's
  // default focus-scroll shove the new view under the sticky gear button —
  // main always starts the view at the top already.
  $('#main').focus({ preventScroll: true });
  scrollTo(0, 0);
}

function render() {
  const v = VIEWS[view];
  $('#main').innerHTML = v.render();
  // No app bar to retitle — the document title carries the view name for
  // tab labels and screen-reader announcements instead.
  document.title = `${t(v.title)} — ${t('app.name')}`;

  $$('.nav__item').forEach(b => {
    const active = b.dataset.go === view;
    b.setAttribute('aria-current', active ? 'page' : 'false');
    b.querySelector('span').textContent = t('nav.' + b.dataset.go);
  });
  $('#btnSettings').setAttribute('aria-label', t('settings.title'));

  // Settings-only widgets; both no-op on other views.
  syncInstallUi();
  syncPersistUi();
}

function onClick(e) {
  const el = e.target.closest('[data-go],[data-ml],[data-lang],[data-sched],[data-custom-day],[data-theme-set],' +
    '[data-del-intake],[data-del-weight],[data-del-session],[data-empty-action],' +
    '[data-toggle-med],[data-edit-med],[data-toggle-chk],[data-del-hdbp],[data-cal-nav],' +
    '#btnWeigh,#btnSession,#btnSettings,#btnAddMed,#btnLogHdBp,#pSave,#btnPrint,#btnWipe,' +
    '#btnCalibrate,#btnExport,#btnImport,#btnInstall,' +
    '#btnCalSchedule,#btnCalWeigh,#btnCalSessions,#btnCalGoogle');
  if (!el) return;

  if (el.id === 'btnCalSchedule') return calSchedule();
  if (el.id === 'btnCalWeigh')    return calWeighIn();
  if (el.id === 'btnCalSessions') return calSessions();
  if (el.id === 'btnCalGoogle')   return calOpenGoogle();

  if (el.dataset.calNav) {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + Number(el.dataset.calNav), 1);
    return render();
  }

  if (el.dataset.go)         return go(el.dataset.go);
  if (el.id === 'btnSettings') return go('settings');
  if (el.id === 'btnWeigh')  return sheetWeight();
  if (el.id === 'btnSession') return sheetSession();
  if (el.id === 'btnAddMed') return sheetMedication();
  if (el.dataset.toggleMed)  return S.toggleMedicationTaken(el.dataset.toggleMed);
  if (el.dataset.editMed)    return sheetMedication(el.dataset.editMed);
  if (el.dataset.toggleChk)  return S.toggleChecklistItem(el.dataset.toggleChk);
  if (el.id === 'btnLogHdBp') return sheetHdBp();
  if (el.dataset.delHdbp) {
    const entry = S.getHdBp().find(r => r.id === el.dataset.delHdbp);
    S.deleteHdBp(entry.id);
    return toast(t('common.delete'), t('common.undo'), () => S.restoreHdBp(entry));
  }
  if (el.id === 'btnCalibrate') return sheetCalibrate();
  if (el.id === 'btnExport') return exportBackup();
  if (el.id === 'btnImport') return $('#importFile').click();

  if (el.id === 'btnInstall') {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => { installPrompt = null; syncInstallUi(); });
    return;
  }

  if (el.dataset.emptyAction) {
    return el.dataset.emptyAction === 'session' ? sheetSession() : sheetWeight();
  }

  if (el.dataset.ml !== undefined) {
    const ml = Number(el.dataset.ml);
    return ml ? addDrink(ml, el.dataset.key) : sheetCustomDrink();
  }

  if (el.dataset.lang) {
    setLang(el.dataset.lang);
    S.saveProfile({ lang: el.dataset.lang });
    return;                                   // store emit() triggers render
  }

  if (el.dataset.sched)     return S.saveProfile({ schedule: el.dataset.sched });
  if (el.dataset.customDay !== undefined) {
    const dow = Number(el.dataset.customDay);
    const days = new Set(S.getProfile().customDays || []);
    days.has(dow) ? days.delete(dow) : days.add(dow);
    return S.saveProfile({ schedule: 'CUSTOM', customDays: [...days].sort() });
  }
  if (el.dataset.themeSet)  { applyTheme(el.dataset.themeSet); return S.saveProfile({ theme: el.dataset.themeSet }); }

  if (el.dataset.delIntake) {
    const entry = S.getIntake().find(i => i.id === el.dataset.delIntake);
    S.deleteIntake(entry.id);
    return toast(t('fluid.removed'), t('common.undo'), () => S.restoreIntake(entry));
  }
  if (el.dataset.delWeight)  return S.deleteWeight(el.dataset.delWeight);
  if (el.dataset.delSession) return S.deleteSession(el.dataset.delSession);

  if (el.id === 'pSave') {
    const dry   = readNumber($('#pDry'),   { min: 20,  max: 250,  required: false });
    if (dry === null) return $('#pDry').focus();
    const allow = readNumber($('#pAllow'), { min: 200, max: 3000, required: false });
    if (allow === null) return $('#pAllow').focus();
    const idwg  = readNumber($('#pIdwg'),  { min: 0.5, max: 6,    required: false });
    if (idwg === null) return $('#pIdwg').focus();
    
    const name    = $('#pName')?.value.trim() ?? '';
    const booklet = $('#pBooklet')?.value.trim() ?? '';
    const doctor  = $('#pDoctor')?.value.trim() ?? '';
    const station = $('#pStation')?.value.trim() ?? '';
    const nurse   = $('#pNurse')?.value.trim() ?? '';
    const emerg   = $('#pEmerg')?.value.trim() ?? '';

    S.saveProfile({
      name,
      bookletNo: booklet,
      doctorName: doctor,
      stationNo: station,
      nursePhone: nurse,
      emergencyPhone: emerg,
      dryWeightKg: dry ?? null,
      allowanceMl: allow ?? null,
      idwgLimitKg: idwg ?? 2.0,
      setupDone: true
    });
    return toast(t('settings.saved'));
  }

  if (el.id === 'btnPrint') return printSummary();
  if (el.id === 'btnWipe') {
    if (confirm(t('settings.wipeConfirm'))) { S.wipeAll(); go('today'); }
    return;
  }
}

/* ---------- theme ---------- */

function applyTheme(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
}

/* ---------- offline banner ---------- */

function wireNetwork() {
  const show = () => {
    const b = $('#offline');
    b.hidden = navigator.onLine;
    b.querySelector('span').textContent = t('common.offline');
  };
  addEventListener('online', show);
  addEventListener('offline', show);
  show();
}

/* ---------- boot ---------- */

function boot() {
  const p = S.getProfile();
  setLang(p.lang);
  applyTheme(p.theme);

  view = (location.hash || '#today').slice(1);
  if (!VIEWS[view]) view = 'today';

  document.addEventListener('click', onClick);

  // The file input is re-created on every render, so listen at document level.
  document.addEventListener('change', e => {
    if (e.target.id === 'pSessionTime' && e.target.value) {
      return void S.saveProfile({ sessionTime: e.target.value });
    }
    if (e.target.id === 'pWeighTime' && e.target.value) {
      return void S.saveProfile({ weighTime: e.target.value });
    }
    if (e.target.id !== 'importFile') return;
    const file = e.target.files?.[0];
    e.target.value = '';                 // allow re-picking the same file
    if (file) importBackup(file);
  });

  // Ask the browser to stop treating our data as evictable cache.
  S.requestPersistence().then(syncPersistUi);

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();                  // keep the mini-infobar off; we have our own button
    installPrompt = e;
    syncInstallUi();
  });
  addEventListener('appinstalled', () => { installPrompt = null; syncInstallUi(); });

  addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    if (VIEWS[next] && next !== view) { view = next; render(); }
  });

  S.subscribe(render);
  wireNetwork();
  render();

  // First run with no targets: drop the patient straight into settings.
  if (!p.setupDone) { view = 'settings'; render(); }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* fine offline */ });
  }
}

// A module script can finish loading after DOMContentLoaded has already
// fired (slow network, cheap phone) — the listener would then never run.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
