/* ===================================================================
   app.js — views, rendering, interaction.
   No framework: this has to boot fast on a cheap Android and work
   with the radio off.
   =================================================================== */

import { t, setLang, getLang, LANGS, langName, glassWord } from './i18n.js';
import * as S from './store.js';
import * as Cal from './calendar.js';
import { FOOD_DB, FOOD_CATS, findFood, mineralLevel } from './foods.js';

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

function foodReminder() {
  const totals = S.todayFoodTotals();
  const kB = S.potassiumBand(), naB = S.sodiumBand();
  const worst = [kB, naB].includes('danger') ? 'danger'
              : [kB, naB].includes('warn') ? 'warn' : undefined;
  return reminderCard({
    go: 'food', iconName: 'fork', tone: worst,
    title: t('food.title'),
    big: `${totals.kcal}<small style="font-size:var(--t-sm);font-weight:600;color:var(--fg-muted)"> ${esc(t('common.kcal'))} · K ${totals.k} · Na ${totals.na}</small>`,
    sub: worst === 'danger' ? t('food.overShort')
       : worst === 'warn' ? t('food.nearShort')
       : t('food.okShort')
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

/* ---------- Lab dashboard card for Today ---------- */

function labFlagBadge(value, key) {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const flag = S.labFlag(Number(value), key);
  if (!flag) return `<span class="lab-badge lab-badge--info">${esc(nf(Number(value), 1))}</span>`;
  const cls = flag === 'normal' ? 'lab-badge--normal'
             : flag === 'high'   ? 'lab-badge--high'
             :                     'lab-badge--low';
  return `<span class="lab-badge ${cls}">${esc(nf(Number(value), 1))} <small style="font-weight:400">${esc(t('labs.flag' + flag.charAt(0).toUpperCase() + flag.slice(1)))}</small></span>`;
}

function labDashboardCard() {
  const lab = S.latestLab();
  if (!lab) {
    return reminderCard({
      go: 'labs', iconName: 'flask',
      title: t('labs.dashboard'),
      big: `<span style="font-size:var(--t-md);color:var(--fg-muted)">—</span>`,
      sub: t('labs.noLab')
    });
  }
  const dateStr = new Date(lab.ts).toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' });
  const items = [
    { key: 'k',   label: 'K',   val: lab.k   },
    { key: 'phos',label: 'Phos',val: lab.phos },
    { key: 'na',  label: 'Na',  val: lab.na   },
    { key: 'albumin', label: 'Alb', val: lab.albumin },
    { key: 'hgb', label: 'Hgb', val: lab.hgb  },
    { key: 'bun', label: 'BUN', val: lab.bun  }
  ].filter(x => x.val != null);

  return `
  <button type="button" class="card chart-card" data-go="labs">
    <div class="card__head">${icon('flask')}<h2>${esc(t('labs.dashboard'))}</h2></div>
    <p class="hint" style="margin:var(--s-1) 0 var(--s-3)">${esc(t('labs.drawn'))}: ${esc(dateStr)}</p>
    <div class="lab-dash-grid">
      ${items.map(it => {
        const flag = S.labFlag(Number(it.val), it.key);
        const flagCls = flag === 'high' ? 'lab-badge--high'
                      : flag === 'low'  ? 'lab-badge--low'
                      : 'lab-badge--normal';
        return `<div class="lab-dash-item">
          <span class="stat__val tnum">${nf(Number(it.val), 1)} <span class="lab-badge ${flagCls}" style="font-size:10px;padding:1px 5px">${esc(flag ? t('labs.flag' + flag.charAt(0).toUpperCase() + flag.slice(1)) : '')}</span></span>
          <span class="stat__key">${esc(it.label)}</span>
        </div>`;
      }).join('')}
    </div>
    <p class="banner" style="margin-top:var(--s-3);margin-bottom:0">${icon('info')}<span>${esc(t('labs.disclaimer'))}</span></p>
  </button>`;
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
    ${foodReminder()}
    ${nextHdReminder()}
    ${labDashboardCard()}
    ${calendarCard()}
    ${trendsSection()}
  </div>`;
}

/* ===================================================================
   View: Labs — Laboratory Results
   =================================================================== */

/** Build a grouped table for one blood-draw record. */
function labDrawCard(lab) {
  const dateStr = new Date(lab.ts).toLocaleDateString(localeTag(),
    { day: 'numeric', month: 'short', year: 'numeric' });

  const GROUPS = [
    {
      titleKey: 'labs.tableElec',
      rows: [
        { key: 'k',           labelKey: 'labs.k',           unit: 'mEq/L' },
        { key: 'na',          labelKey: 'labs.na',          unit: 'mEq/L' },
        { key: 'bicarbonate', labelKey: 'labs.bicarbonate', unit: 'mEq/L' },
        { key: 'calcium',     labelKey: 'labs.calcium',     unit: 'mg/dL' },
        { key: 'uricAcid',    labelKey: 'labs.uricAcid',    unit: 'mg/dL' }
      ]
    },
    {
      titleKey: 'labs.tableKidney',
      rows: [
        { key: 'bun',        labelKey: 'labs.bun',        unit: 'mg/dL' },
        { key: 'creatinine', labelKey: 'labs.creatinine', unit: 'mg/dL' },
        { key: 'hgb',        labelKey: 'labs.hgb',        unit: 'g/dL'  }
      ]
    },
    {
      titleKey: 'labs.tableNutrition',
      rows: [
        { key: 'phos',    labelKey: 'labs.phos',    unit: 'mg/dL' },
        { key: 'albumin', labelKey: 'labs.albumin', unit: 'g/dL'  }
      ]
    }
  ];

  const groupHtml = GROUPS.map(grp => {
    const visibleRows = grp.rows.filter(r => lab[r.key] != null);
    if (!visibleRows.length) return '';
    const rowsHtml = visibleRows.map(r => {
      const val   = Number(lab[r.key]);
      const flag  = S.labFlag(val, r.key);
      const trCls = flag && flag !== 'normal' ? `lab-tr--${flag}` : '';
      const badgeCls = flag === 'normal' ? 'lab-badge--normal'
                     : flag === 'high'   ? 'lab-badge--high'
                     : flag === 'low'    ? 'lab-badge--low'
                     :                    'lab-badge--info';
      const badgeLabel = flag ? esc(t('labs.flag' + flag.charAt(0).toUpperCase() + flag.slice(1))) : '—';
      return `<tr class="${trCls}">
        <td class="lab-td__name">${esc(t(r.labelKey))}</td>
        <td class="lab-td__val tnum">${nf(val, 2)}</td>
        <td class="lab-td__unit">${r.unit}</td>
        <td class="lab-td__flag"><span class="lab-badge ${badgeCls}">${badgeLabel}</span></td>
      </tr>`;
    }).join('');
    return `
      <p class="lab-group-title">${esc(t(grp.titleKey))}</p>
      <div class="lab-table-scroll">
        <table class="lab-table">
          <thead><tr>
            <th class="lab-td__name">${esc(t('labs.title'))}</th>
            <th class="lab-td__val">Value</th>
            <th class="lab-td__unit">Unit</th>
            <th class="lab-td__flag">Status</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }).join('');

  const noteHtml = lab.note
    ? `<p class="hint" style="padding:var(--s-2) var(--s-4)">${esc(lab.note)}</p>`
    : '';

  return `
  <div class="lab-draw-card card" style="padding:0">
    <div class="lab-draw-head">
      <h3>${esc(dateStr)}</h3>
      <button type="button" class="row__btn" data-del-lab="${lab.id}"
              aria-label="${esc(t('common.delete'))} ${esc(dateStr)}">${icon('trash')}</button>
    </div>
    ${groupHtml}
    ${noteHtml}
  </div>`;
}

function viewLabs() {
  const logs = S.getLabLogs();
  return `
  <div class="view">
    <button type="button" class="btn btn--primary" id="btnAddLab" style="width:100%;margin-bottom:var(--s-4)">
      ${icon('plus')}<span>${esc(t('labs.addBtn'))}</span>
    </button>
    <p class="banner">${icon('info')}<span>${esc(t('labs.disclaimer'))}</span></p>
    ${logs.length
      ? logs.map(lab => labDrawCard(lab)).join('')
      : `<div class="empty">${icon('flask')}<p>${esc(t('labs.empty'))}</p></div>`}
  </div>`;
}

/** Bottom sheet to add a new blood-draw record. */
function sheetLabEntry() {
  const today = new Date().toISOString().slice(0, 10);
  const FIELDS = [
    { id: 'lK',   label: 'labs.k',           unit: 'mEq/L', step: '0.1', min: '1',   max: '10',  placeholder: '4.5' },
    { id: 'lPhos',label: 'labs.phos',         unit: 'mg/dL', step: '0.1', min: '0.5', max: '15',  placeholder: '4.5' },
    { id: 'lNa',  label: 'labs.na',           unit: 'mEq/L', step: '0.1', min: '100', max: '170', placeholder: '138' },
    { id: 'lAlb', label: 'labs.albumin',      unit: 'g/dL',  step: '0.1', min: '1',   max: '6',   placeholder: '3.8' },
    { id: 'lHgb', label: 'labs.hgb',          unit: 'g/dL',  step: '0.1', min: '4',   max: '20',  placeholder: '11'  },
    { id: 'lBun', label: 'labs.bun',          unit: 'mg/dL', step: '1',   min: '1',   max: '400', placeholder: '60'  },
    { id: 'lCr',  label: 'labs.creatinine',   unit: 'mg/dL', step: '0.1', min: '0.1', max: '30',  placeholder: '8.5' },
    { id: 'lHco', label: 'labs.bicarbonate',  unit: 'mEq/L', step: '0.1', min: '5',   max: '40',  placeholder: '20'  },
    { id: 'lCa',  label: 'labs.calcium',      unit: 'mg/dL', step: '0.1', min: '5',   max: '15',  placeholder: '9.2' },
    { id: 'lUa',  label: 'labs.uricAcid',     unit: 'mg/dL', step: '0.1', min: '1',   max: '20',  placeholder: '6.5' }
  ];

  openSheet({
    title: t('labs.sheetTitle'),
    body: `
      <div class="field">
        <label for="lDate">${esc(t('labs.date'))} <span class="req">*</span></label>
        <input class="input" id="lDate" type="date" value="${today}">
        <div class="err" id="lDate-err" role="alert" aria-live="polite"></div>
      </div>
      <div class="field-row">
        ${FIELDS.slice(0, 4).map(f => `
          <div class="field">
            <label for="${f.id}">${esc(t(f.label))} <small style="font-weight:400;color:var(--fg-muted)">${f.unit}</small></label>
            <input class="input" id="${f.id}" type="number" inputmode="decimal"
                   step="${f.step}" min="${f.min}" max="${f.max}" placeholder="${f.placeholder}" autocomplete="off">
          </div>`).join('')}
      </div>
      <div class="field-row">
        ${FIELDS.slice(4).map(f => `
          <div class="field">
            <label for="${f.id}">${esc(t(f.label))} <small style="font-weight:400;color:var(--fg-muted)">${f.unit}</small></label>
            <input class="input" id="${f.id}" type="number" inputmode="decimal"
                   step="${f.step}" min="${f.min}" max="${f.max}" placeholder="${f.placeholder}" autocomplete="off">
          </div>`).join('')}
      </div>
      <div class="field">
        <label for="lNote">${esc(t('labs.note'))}</label>
        <input class="input" id="lNote" type="text" maxlength="300" autocomplete="off"
               placeholder="e.g. pre-dialysis draw, fasting">
      </div>
      <p class="banner">${icon('info')}<span>${esc(t('labs.disclaimer'))}</span></p>
      <button type="button" class="btn btn--primary" id="lSave" style="width:100%">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>`,
    onMount(sheet) {
      $('#lSave', sheet).addEventListener('click', () => {
        const dateVal = $('#lDate', sheet).value;
        if (!dateVal) {
          const errEl = $('#lDate-err', sheet);
          if (errEl) errEl.textContent = t('common.required');
          $('#lDate', sheet).focus();
          return;
        }
        const readVal = id => {
          const el = $(id, sheet);
          const v = el ? el.value.trim() : '';
          return v === '' ? null : Number(v);
        };
        const entry = S.logLab({
          day:         dateVal,
          k:           readVal('#lK'),
          phos:        readVal('#lPhos'),
          na:          readVal('#lNa'),
          albumin:     readVal('#lAlb'),
          hgb:         readVal('#lHgb'),
          bun:         readVal('#lBun'),
          creatinine:  readVal('#lCr'),
          bicarbonate: readVal('#lHco'),
          calcium:     readVal('#lCa'),
          uricAcid:    readVal('#lUa'),
          note:        $('#lNote', sheet)?.value.trim() || ''
        }, new Date(dateVal + 'T12:00:00'));
        closeSheet();
        toast(t('labs.saved'), t('common.undo'), () => S.deleteLab(entry.id));
      });
    }
  });
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
   View: Food tracker (potassium / sodium) — ported concept from FoodYou
   -------------------------------------------------------------------
   Dialysis patients cannot clear potassium or sodium between sessions.
   High potassium can stop the heart; high sodium drives thirst, fluid
   overload and high blood pressure. This tab flags high-K / high-Na
   foods BEFORE the patient eats, and sounds an alarm when a logged food
   is dangerous or the day's budget is blown.
   =================================================================== */

/** Attention-grabbing alarm for a high-mineral food: buzz the phone and
    play a short two-tone beep. Both are best-effort — vibration needs a
    real device; WebAudio needs a prior user gesture, which the tap that
    triggered this satisfies. */
function foodAlarm() {
  try { navigator.vibrate?.([180, 90, 180, 90, 280]); } catch { /* unsupported */ }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const beep = (freq, start, dur) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur + 0.03);
    };
    beep(880, 0, 0.18); beep(880, 0.26, 0.32);
    setTimeout(() => { try { ctx.close(); } catch {} }, 1000);
  } catch { /* audio blocked; vibration/visuals still fired */ }
}

/** One coloured chip: "K 420 mg" tinted ok / moderate / high. */
/* Minimal reading, not a filled chip: a muted "K 420 mg" with a small dot
   that only shows colour when there is something to flag. Used in the
   portion sheet's live projection, where a loud badge would fight with
   the sheet's own alarm banner for attention. */
const MINERAL_LABEL = { k: 'K', na: 'Na', ph: 'P' };
function mineralBadge(mg, kind) {
  const lvl = mineralLevel(mg, kind);
  const dot = lvl === 'ok' ? '' : ` <i class="fdot fdot--${lvl}"></i>`;
  return `<span class="freading">${MINERAL_LABEL[kind]} ${Math.round(mg)} ${esc(t('common.mg'))}${dot}</span>`;
}

/** One stat column inside the MyFitnessPal-style diary summary: Goal,
    Food (logged so far) and Remaining, the same triplet MFP's calorie
    card shows, with Remaining the one large emphasised number. Handles
    all three tracked numbers — kcal plus the two minerals — since kcal
    has no "mg" unit and its own goal/band lookups. */
function summaryCol(kind) {
  const totals = S.todayFoodTotals();
  const p = S.getProfile();
  const cfg = {
    kcal: { total: totals.kcal, limit: p.kcalGoal,                     band: S.kcalBand(),       title: t('food.calories'),   unit: '' },
    k:    { total: totals.k,    limit: S.effectivePotassiumLimitMg(p),  band: S.potassiumBand(),  title: t('food.potassium'),  unit: ` ${t('common.mg')}` },
    na:   { total: totals.na,   limit: p.sodiumLimitMg,                band: S.sodiumBand(),     title: t('food.sodium'),     unit: ` ${t('common.mg')}` },
    ph:   { total: totals.ph,   limit: S.effectivePhosphorusLimitMg(p), band: S.phosphorusBand(), title: t('food.phosphorus'), unit: ` ${t('common.mg')}` }
  }[kind];
  const b = cfg.band || 'ok';
  const remaining = cfg.limit - cfg.total;
  const remColor = b === 'danger' ? 'var(--danger)' : b === 'warn' ? 'var(--warn)' : 'var(--brand)';
  return `
  <div class="mfp-col">
    <p class="mfp-col__label">${esc(cfg.title)}</p>
    <p class="mfp-col__remaining tnum" style="color:${remColor}">
      ${remaining < 0 ? Math.round(-remaining) : Math.round(remaining)}
    </p>
    <p class="mfp-col__remaining-caption">${esc(remaining < 0 ? t('food.over') : t('food.remaining'))}</p>
    <p class="mfp-col__breakdown tnum">
      <span>${esc(t('food.goal'))} <b>${Math.round(cfg.limit)}${esc(cfg.unit)}</b></span>
      <span>${esc(t('food.foodCol'))} <b>${Math.round(cfg.total)}${esc(cfg.unit)}</b></span>
    </p>
  </div>`;
}

/** The diary's top summary card — MyFitnessPal's calorie card, extended
    with the three KDOQI ceiling nutrients (potassium, sodium, phosphorus)
    alongside kcal. Calories lead, same order MFP itself uses; wraps to
    2×2 on a narrow phone instead of squeezing four columns into one row. */
function foodSummaryCard() {
  const cols = ['kcal', 'k', 'na', 'ph'];
  return `
  <div class="card mfp-summary">
    ${cols.map(summaryCol).join('<div class="mfp-summary__divider"></div>')}
  </div>`;
}

/** Protein and fiber are daily MINIMUMS (KDOQI: 1.0-1.2 g/kg protein,
    25-34 g fiber) — "more is good, up to the goal" instead of "less is
    good", so this reuses the .meter component but with goal-progress
    framing (X of Y met) rather than the K/Na/kcal "remaining" framing. */
function goalBar(kind) {
  const totals = S.todayFoodTotals();
  const p = S.getProfile();
  const cfg = kind === 'fiber'
    ? { total: totals.fiber,   goal: p.fiberGoalG,               band: S.fiberBand(),   title: t('food.fiber'),   unit: t('common.g'), icon: 'bowl' }
    : { total: totals.protein, goal: S.effectiveProteinGoalG(p), band: S.proteinBand(), title: t('food.protein'), unit: t('common.g'), icon: 'activity' };
  const b = cfg.band || 'ok';
  const pct = Math.min(100, Math.max(0, (cfg.total / (cfg.goal || 1)) * 100));
  return `
  <div class="card">
    <div class="card__head">${icon(cfg.icon)}<h2>${esc(cfg.title)}</h2></div>
    <p class="status__num tnum" style="font-size:var(--t-xl);margin:0;color:${
      b === 'ok' ? 'var(--ok)' : b === 'warn' ? 'var(--warn)' : 'var(--danger)'}">
      ${nf(cfg.total, 1)}<span class="status__unit"> / ${cfg.goal} ${esc(cfg.unit)}</span>
    </p>
    <div class="meter meter--${b === 'ok' ? 'ok' : b === 'warn' ? 'warn' : 'danger'}">
      <div class="meter__track">
        <div class="meter__fill" style="width:${pct}%" role="progressbar"
             aria-valuenow="${nf(cfg.total, 1)}" aria-valuemin="0" aria-valuemax="${cfg.goal}"
             aria-label="${esc(cfg.title)}"></div>
      </div>
      <p class="meter__scale">
        <span>0</span><span class="tnum">${esc(t('food.goal'))}: ${cfg.goal} ${esc(cfg.unit)}</span>
      </p>
    </div>
    ${b === 'danger' ? `<p class="status__advice" style="margin-top:var(--s-3)">${icon('info')}<span>${esc(t('food.' + kind + 'LowAdvice'))}</span></p>` : ''}
  </div>`;
}

/* Minimalist catalog: a flat list of rows, not a grid of coloured cards.
   Each row is plain text plus two muted numbers; the only colour is the
   small dot from mineralBadge() when a food actually needs a second
   look, so the eye lands on the two or three foods that matter instead
   of a wall of tinted tiles. */
/** Search-first, like MFP's own "Add Food" screen: no wall of every food
    in the database on open, just the search box. Results (grouped by
    category) appear once the patient actually types something. */
function foodCatalog(filter = '') {
  const q = filter.trim().toLowerCase();
  if (!q) return `<p class="food-search-hint">${esc(t('food.searchHint'))}</p>`;
  const html = FOOD_CATS.map(cat => {
    const items = FOOD_DB.filter(f => f.cat === cat.id && f.name.toLowerCase().includes(q));
    if (!items.length) return '';
    return `
    <h3 class="section-title food-cat">${esc(t('food.cat.' + cat.id))}</h3>
    <div class="food-list">
      ${items.map(f => `
        <button type="button" class="food-row" data-food="${f.id}">
          <span class="food-row__name">${esc(f.name)}
            <small class="food-row__serving">${esc(f.serving)}${
              f.g ? ` · ${f.g} ${esc(t('common.g'))}` : ''}${
              f.ml ? ` · ${f.ml} ${esc(t('common.ml'))}` : ''}</small>
          </span>
          <span class="food-row__nums">
            <span class="freading">${f.kcal} ${esc(t('common.kcal'))}</span>
            ${mineralBadge(f.k, 'k')}${mineralBadge(f.na, 'na')}${mineralBadge(f.ph, 'ph')}
          </span>
        </button>`).join('')}
    </div>`;
  }).join('');
  return html || `<p class="food-search-hint">${esc(t('food.noResults'))}</p>`;
}

/** One meal section — Breakfast, Lunch, Dinner — laid out the way
    MyFitnessPal's diary does: a header row with the meal name and its
    running total, a plain <table> of what was logged, and an "+ Add
    Food" row at the bottom that opens the picker scoped to this meal.
    Always rendered, even empty, so all three meals are there to log
    into as the day goes rather than appearing only after first use. */
function mealTable(mealKey, entries) {
  const rows = entries.map(e => {
    const kLvl = mineralLevel(e.kMg, 'k'), naLvl = mineralLevel(e.naMg, 'na'), phLvl = mineralLevel(e.phMg, 'ph');
    const hot = kLvl === 'high' || naLvl === 'high' || phLvl === 'high';
    return `
    <tr class="${hot ? 'food-tr--hot' : ''}">
      <td class="food-td__name">${esc(e.name)}${
        e.servings !== 1 ? ` <small class="tnum">×${nf(e.servings, 1)}</small>` : ''}</td>
      <td class="food-td__num tnum">${e.kcal}</td>
      <td class="food-td__num tnum">${e.kMg}</td>
      <td class="food-td__num tnum">${e.naMg}</td>
      <td class="food-td__num tnum">${e.phMg}</td>
      <td class="food-td__del">
        <button type="button" class="row__btn" data-del-food="${e.id}"
                aria-label="${esc(t('common.delete'))} ${esc(e.name)}">${icon('trash')}</button>
      </td>
    </tr>`;
  }).join('');

  const sub = entries.reduce((a, e) =>
    ({ kcal: a.kcal + e.kcal, k: a.k + e.kMg, na: a.na + e.naMg, ph: a.ph + e.phMg }),
    { kcal: 0, k: 0, na: 0, ph: 0 });

  return `
  <div class="card meal-section">
    <div class="meal-section__head">
      <h3>${esc(t('food.meal.' + mealKey))}</h3>
      ${entries.length
        ? `<span class="meal-section__total tnum">${sub.kcal} ${esc(t('common.kcal'))} · K ${sub.k} · Na ${sub.na} · P ${sub.ph} ${esc(t('common.mg'))}</span>`
        : ''}
    </div>
    <div class="food-table-scroll">
      <table class="food-table">
        <thead><tr>
          <th class="food-td__name">${esc(t('food.colFood'))}</th>
          <th class="food-td__num">${esc(t('food.colKcal'))}</th>
          <th class="food-td__num">K</th>
          <th class="food-td__num">Na</th>
          <th class="food-td__num">P</th>
          <th class="food-td__del"></th>
        </tr></thead>
        <tbody>
          ${rows || `<tr><td class="food-td__empty" colspan="6">${esc(t('food.mealEmpty'))}</td></tr>`}
        </tbody>
      </table>
    </div>
    <button type="button" class="add-food-row" data-add-meal="${mealKey}">
      ${icon('plus')}<span>${esc(t('food.addFood'))}</span>
    </button>
  </div>`;
}

function foodLogTables() {
  const byMeal = S.todayFoodByMeal();
  return S.MEALS.map(m => mealTable(m, byMeal[m])).join('');
}

function viewFood() {
  const over = S.potassiumBand() === 'danger' || S.sodiumBand() === 'danger' || S.phosphorusBand() === 'danger';
  return `
  <div class="view">
    ${over ? `<p class="banner banner--danger">${icon('alert-octagon')}<span>${esc(t('food.overAlarm'))}</span></p>` : ''}
    ${foodSummaryCard()}
    <div class="today-grid-2">
      ${goalBar('protein')}
      ${goalBar('fiber')}
    </div>
    <p class="banner">${icon('info')}<span>${esc(t('food.estimate'))}</span></p>
    ${foodLogTables()}
  </div>`;
}

/* Search text lives in module state so a store-driven re-render (e.g. an
   undo toast firing emit) keeps whatever the patient has typed. */
let foodSearch = '';

/** Food picker — MyFitnessPal's "Add Food" search screen, opened from a
    meal section's "+ Add Food" row. Search + the same minimalist
    catalog list used before; tapping a food hands off to the portion
    sheet with this meal already selected. */
function sheetFoodPicker(meal) {
  foodSearch = '';
  openSheet({
    title: `${t('food.addFood')} — ${t('food.meal.' + meal)}`,
    body: `
      <div class="field" style="margin-bottom:var(--s-2)">
        <input class="input" id="foodSearch" type="search" enterkeyhint="search"
               placeholder="${esc(t('food.search'))}" autocomplete="off">
      </div>
      <div id="foodCatalog">${foodCatalog('')}</div>`,
    onMount(sheet) {
      $('#foodSearch', sheet).focus();
      $('#foodSearch', sheet).addEventListener('input', e => {
        foodSearch = e.target.value;
        $('#foodCatalog', sheet).innerHTML = foodCatalog(foodSearch);
      });
      sheet.addEventListener('click', e => {
        const row = e.target.closest('[data-food]');
        if (!row) return;
        // [data-food] is also in the document-level delegated selector
        // (for the picker's own rows to be clickable at all); stop here
        // so that handler doesn't ALSO fire and open a second, meal-less
        // portion sheet right behind this one.
        e.stopPropagation();
        closeSheet();
        sheetFoodLog(row.dataset.food, meal);
      });
    }
  });
}

/** Portion picker + alarm gate. Recomputes the projected K/Na live as the
    patient changes servings; a high projection turns the save button red
    and the warning banner on, and sounds the alarm on log. */
function sheetFoodLog(foodId, presetMeal = null) {
  const f = findFood(foodId);
  if (!f) return;
  const defaultMeal = S.MEALS.includes(presetMeal) ? presetMeal : S.inferMeal();

  const g1 = f.g || 0;  // grams in ONE serving, for the servings<->grams sync below

  openSheet({
    title: f.name,
    body: `
      <p class="hint" style="margin-top:0">${esc(f.serving)}${
        g1 ? ` · ${g1} ${esc(t('common.g'))}` : ''}${
        f.ml ? ` · ${f.ml} ${esc(t('common.ml'))} ${esc(t('food.alsoFluid'))}` : ''}</p>

      <div class="field">
        <label>${esc(t('food.meal'))}</label>
        <div class="seg" role="group" aria-label="${esc(t('food.meal'))}">
          ${S.MEALS.map(m => `<button type="button" data-meal="${m}"
              aria-pressed="${m === defaultMeal}">${esc(t('food.meal.' + m))}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label for="fServ">${esc(t('food.servings'))}</label>
        <div class="seg" role="group" aria-label="${esc(t('food.servings'))}">
          <button type="button" data-serv="0.5">½</button>
          <button type="button" data-serv="1">1</button>
          <button type="button" data-serv="2">2</button>
          <button type="button" data-serv="3">3</button>
        </div>
        <input class="input input--big" id="fServ" type="number" inputmode="decimal"
               step="0.5" min="0.5" max="20" value="1" style="margin-top:var(--s-2)">
        <div class="err" id="fServ-err" role="alert" aria-live="polite"></div>
      </div>

      ${g1 ? `
      <div class="field">
        <label for="fGrams">${esc(t('food.gramsLabel'))}</label>
        <input class="input" id="fGrams" type="number" inputmode="numeric"
               step="1" min="1" max="${Math.round(g1 * 20)}" value="${g1}">
        <div class="err" id="fGrams-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('food.gramsHint'))}</p>
      </div>` : ''}

      <div class="fproj" id="fProj" aria-live="polite"></div>
      <div class="banner banner--danger" id="fWarn" hidden>
        ${icon('alert-octagon')}<span></span>
      </div>

      <button type="button" class="btn btn--primary" id="fSave">
        ${icon('check')}<span>${esc(t('common.save'))}</span>
      </button>`,
    onMount(sheet) {
      const input = $('#fServ', sheet);
      const grams = $('#fGrams', sheet);
      const proj  = $('#fProj', sheet);
      const warn  = $('#fWarn', sheet);
      const btn   = $('#fSave', sheet);
      let meal = defaultMeal;

      $$('[data-meal]', sheet).forEach(b => b.addEventListener('click', () => {
        meal = b.dataset.meal;
        $$('[data-meal]', sheet).forEach(x => x.setAttribute('aria-pressed', x === b));
      }));

      /* Servings and grams are the same quantity read two ways — keep
         them in lockstep so a patient can either tap "2 servings" or
         type "236g" off a kitchen scale and get the same log entry.
         Only ever one side re-renders the other, never both at once,
         so there's no feedback loop. */
      const syncGramsFromServings = () => {
        if (g1) grams.value = Math.round((Number(input.value) || 0) * g1);
      };
      const syncServingsFromGrams = () => {
        if (g1) input.value = (Math.round((Number(grams.value) || 0) / g1 * 100) / 100).toString();
      };

      const refresh = () => {
        const s = Number(input.value) || 0;
        const k = f.k * s, na = f.na * s, ph = (f.ph || 0) * s;
        const protein = (f.protein || 0) * s, fiber = (f.fiber || 0) * s;
        proj.innerHTML = `<span class="freading">${Math.round((f.kcal || 0) * s)} ${esc(t('common.kcal'))}</span>` +
          ` ${mineralBadge(k, 'k')} ${mineralBadge(na, 'na')} ${mineralBadge(ph, 'ph')}` +
          ` <span class="freading">${nf(protein, 1)}${esc(t('common.g'))} ${esc(t('food.protein'))}</span>` +
          ` <span class="freading">${nf(fiber, 1)}${esc(t('common.g'))} ${esc(t('food.fiber'))}</span>`;

        const hot = { k: mineralLevel(k, 'k') === 'high', na: mineralLevel(na, 'na') === 'high', ph: mineralLevel(ph, 'ph') === 'high' };
        const hotKinds = Object.keys(hot).filter(kind => hot[kind]);
        const high = hotKinds.length > 0;
        warn.hidden = !high;
        if (high) {
          const label = { k: t('food.kHigh'), na: t('food.naHigh'), ph: t('food.phHigh') };
          warn.querySelector('span').textContent = hotKinds.length > 1
            ? t('food.multiHigh')
            : label[hotKinds[0]];
        }
        btn.classList.toggle('btn--danger', high);
        btn.classList.toggle('btn--primary', !high);
        btn.querySelector('span').textContent = high ? t('food.logAnyway') : t('common.save');
        return { s, high };
      };

      $$('[data-serv]', sheet).forEach(b =>
        b.addEventListener('click', () => { input.value = b.dataset.serv; syncGramsFromServings(); refresh(); }));
      input.addEventListener('input', () => { syncGramsFromServings(); refresh(); });
      grams?.addEventListener('input', () => { syncServingsFromGrams(); refresh(); });
      refresh();

      const save = () => {
        const s = readNumber(input, { min: 0.5, max: 20 });
        if (s == null) { input.focus(); return; }
        const { high } = refresh();
        const entry = S.logFood(f.id, s, new Date(), meal);
        closeSheet();
        if (high) {
          foodAlarm();
          toast(t('food.loggedHigh'), t('common.undo'), () => S.deleteFood(entry.id));
        } else {
          toast(t('food.logged'), t('common.undo'), () => S.deleteFood(entry.id));
        }
      };
      btn.addEventListener('click', save);
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
  const kcalSuggest = S.recommendedKcalRange(p);
  const proteinSuggest = S.recommendedProteinRange(p);
  // Whether each goal is CURRENTLY locked to a lab-derived number —
  // Auto can be on with no lab yet, in which case there's nothing to
  // lock to and the field stays a normal manual input.
  const kAuto = p.autoGoalsFromLabs && !!S.recommendedPotassiumRangeFromLab(p);
  const phAuto = p.autoGoalsFromLabs && !!S.recommendedPhosphorusRangeFromLab(p);
  const proteinAuto = p.autoGoalsFromLabs && !!p.dryWeightKg;
  const effK = S.effectivePotassiumLimitMg(p);
  const effPh = S.effectivePhosphorusLimitMg(p);
  const effProtein = S.effectiveProteinGoalG(p);
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
      <div class="field" style="display:flex;align-items:center;gap:var(--s-2)">
        <input type="checkbox" id="pAutoGoals" ${p.autoGoalsFromLabs ? 'checked' : ''}>
        <label for="pAutoGoals" style="margin:0">${esc(t('settings.autoGoals'))}</label>
      </div>
      <p class="hint">${esc(t('settings.autoGoalsHint'))}</p>
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
      <div class="field-row">
        <div class="field">
          <label for="pK">${esc(t('settings.potassiumLimit'))}</label>
          <input class="input" id="pK" type="number" inputmode="numeric" step="100"
                 min="500" max="5000" value="${(kAuto ? effK : p.potassiumLimitMg) ?? 2000}"
                 ${kAuto ? 'disabled' : ''}>
          <div class="err" id="pK-err" role="alert" aria-live="polite"></div>
          ${kAuto ? `<p class="hint">${esc(t('settings.autoLocked'))}</p>` : ''}
        </div>
        <div class="field">
          <label for="pNa">${esc(t('settings.sodiumLimit'))}</label>
          <input class="input" id="pNa" type="number" inputmode="numeric" step="100"
                 min="500" max="5000" value="${p.sodiumLimitMg ?? 2300}">
          <div class="err" id="pNa-err" role="alert" aria-live="polite"></div>
        </div>
      </div>
      <p class="hint">${esc(t('settings.mineralHint'))}</p>
      <div class="field">
        <label for="pPh">${esc(t('settings.phosphorusLimit'))}</label>
        <input class="input" id="pPh" type="number" inputmode="numeric" step="50"
               min="300" max="3000" value="${(phAuto ? effPh : p.phosphorusLimitMg) ?? 900}"
               ${phAuto ? 'disabled' : ''}>
        <div class="err" id="pPh-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('settings.phosphorusHint'))}${phAuto ? ` ${esc(t('settings.autoLocked'))}` : ''}</p>
      </div>
      <div class="field">
        <label for="pKcal">${esc(t('settings.kcalGoal'))}</label>
        <input class="input" id="pKcal" type="number" inputmode="numeric" step="50"
               min="800" max="5000" value="${p.kcalGoal ?? 1800}">
        <div class="err" id="pKcal-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('settings.kcalHint'))}${
          kcalSuggest ? ` ${esc(t('settings.suggested'))}: ${kcalSuggest.low}–${kcalSuggest.high} ${esc(t('common.kcal'))}.` : ''}</p>
      </div>
      <div class="field">
        <label for="pProtein">${esc(t('settings.proteinGoal'))}</label>
        <input class="input" id="pProtein" type="number" inputmode="numeric" step="5"
               min="20" max="250" value="${(proteinAuto ? effProtein : p.proteinGoalG) ?? 60}"
               ${proteinAuto ? 'disabled' : ''}>
        <div class="err" id="pProtein-err" role="alert" aria-live="polite"></div>
        ${proteinAuto ? `<p class="hint">${esc(t('settings.autoLocked'))}</p>` : ''}
        <p class="hint">${esc(t('settings.proteinHint'))}${
          proteinSuggest ? ` ${esc(t('settings.suggested'))}: ${proteinSuggest.low}–${proteinSuggest.high} ${esc(t('common.g'))}.` : ''}</p>
      </div>
      <div class="field">
        <label for="pFiber">${esc(t('settings.fiberGoal'))}</label>
        <input class="input" id="pFiber" type="number" inputmode="numeric" step="1"
               min="10" max="60" value="${p.fiberGoalG ?? 30}">
        <div class="err" id="pFiber-err" role="alert" aria-live="polite"></div>
        <p class="hint">${esc(t('settings.fiberHint'))}</p>
      </div>

      <h3 class="section-title" style="margin-top:var(--s-5)">${esc(t('settings.labTitle'))}</h3>
      <p class="hint" style="margin-top:0">${esc(t('settings.labHint'))}</p>
      ${(() => {
        const lab = S.latestLab();
        const labKSuggest = S.recommendedPotassiumRangeFromLab(p);
        const labPhSuggest = S.recommendedPhosphorusRangeFromLab(p);
        if (!lab) return `
          <p class="hint">${esc(t('labs.noLab'))}</p>
          <button type="button" class="btn btn--ghost" data-go="labs" style="width:100%">
            ${icon('flask')}<span>${esc(t('labs.addBtn'))}</span>
          </button>`;
        const dateStr = new Date(lab.ts).toLocaleDateString(localeTag(),
          { day: 'numeric', month: 'short', year: 'numeric' });
        return `
          <div class="row" style="margin-bottom:var(--s-2)">
            <span class="row__icon">${icon('flask')}</span>
            <span class="row__body">
              <span class="row__title">${esc(t('labs.drawn'))}: ${esc(dateStr)}</span>
              <span class="row__sub tnum">
                ${lab.k    != null ? `K ${nf(lab.k,1)} · ` : ''}
                ${lab.phos != null ? `Phos ${nf(lab.phos,1)} · ` : ''}
                ${lab.na   != null ? `Na ${nf(lab.na,1)}` : ''}
              </span>
            </span>
            <button type="button" class="row__btn" data-go="labs" aria-label="${esc(t('labs.title'))}">${icon('chevron-right')}</button>
          </div>
          ${labKSuggest ? `
          <p class="hint">${esc(t('settings.labKFlag.' + labKSuggest.flag))}
            ${esc(t('settings.suggested'))}: ${labKSuggest.low}–${labKSuggest.high} ${esc(t('common.mg'))}.
            ${p.autoGoalsFromLabs ? esc(t('settings.autoLocked')) : `<button type="button" class="row__btn" data-apply-lab="k" data-lo="${labKSuggest.low}" data-hi="${labKSuggest.high}"
                    aria-label="${esc(t('settings.labApply'))}" style="display:inline-flex;vertical-align:middle">${icon('check')}</button>`}
          </p>` : ''}
          ${labPhSuggest ? `
          <p class="hint">${esc(t('settings.labPhFlag.' + labPhSuggest.flag))}
            ${esc(t('settings.suggested'))}: ${labPhSuggest.low}–${labPhSuggest.high} ${esc(t('common.mg'))}.
            ${p.autoGoalsFromLabs ? esc(t('settings.autoLocked')) : `<button type="button" class="row__btn" data-apply-lab="ph" data-lo="${labPhSuggest.low}" data-hi="${labPhSuggest.high}"
                    aria-label="${esc(t('settings.labApply'))}" style="display:inline-flex;vertical-align:middle">${icon('check')}</button>`}
          </p>` : ''}`;
      })()}
      <p class="banner">${icon('info')}<span>${esc(t('settings.labDisclaimer'))}</span></p>

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
        <li class="row"><span class="row__body">Calories today</span>
            <span class="row__val tnum">${S.todayFoodTotals().kcal} kcal (goal ${p.kcalGoal})</span></li>
        <li class="row"><span class="row__body">Potassium / Sodium / Phosphorus today</span>
            <span class="row__val tnum">${S.todayFoodTotals().k} / ${S.todayFoodTotals().na} / ${S.todayFoodTotals().ph} mg
              (limit ${p.potassiumLimitMg}/${p.sodiumLimitMg}/${p.phosphorusLimitMg})</span></li>
        <li class="row"><span class="row__body">Protein / Fiber today</span>
            <span class="row__val tnum">${nf(S.todayFoodTotals().protein, 1)} / ${nf(S.todayFoodTotals().fiber, 1)} g
              (goal ${p.proteinGoalG}/${p.fiberGoalG})</span></li>
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
  food:     { render: viewFood,     title: 'food.title'     },
  weight:   { render: viewWeight,   title: 'weight.title'   },
  meds:     { render: viewMeds,     title: 'meds.title'     },
  session:  { render: viewSession,  title: 'session.title'  },
  labs:     { render: viewLabs,     title: 'labs.title'     },
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
    '[data-del-food],[data-add-meal],[data-apply-lab],[data-del-lab],' +
    '[data-toggle-med],[data-edit-med],[data-toggle-chk],[data-del-hdbp],[data-cal-nav],' +
    '#btnWeigh,#btnSession,#btnSettings,#btnAddMed,#btnLogHdBp,#btnAddLab,#pSave,#btnPrint,#btnWipe,' +
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
  if (el.id === 'btnAddLab') return sheetLabEntry();
  if (el.dataset.delLab) {
    const entry = S.getLabLogs().find(e => e.id === el.dataset.delLab);
    if (entry) {
      S.deleteLab(entry.id);
      toast(t('labs.deleted'), t('common.undo'), () => S.logLab(entry, new Date(entry.ts)));
    }
    return;
  }
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

  if (el.dataset.addMeal)    return sheetFoodPicker(el.dataset.addMeal);
  if (el.dataset.applyLab) {
    // Fills the goal input with the lab-based suggestion's midpoint;
    // the patient/nurse still has to hit the Targets card's own Save
    // button below to actually persist it — this only sets the field.
    const targetId = el.dataset.applyLab === 'k' ? '#pK' : '#pPh';
    const mid = Math.round((Number(el.dataset.lo) + Number(el.dataset.hi)) / 2 / 50) * 50;
    const targetInput = $(targetId);
    if (targetInput) { targetInput.value = mid; targetInput.focus(); }
    return toast(t('settings.labApplied'));
  }
  if (el.dataset.delFood) {
    const entry = S.getFoodLogs().find(e => e.id === el.dataset.delFood);
    S.deleteFood(entry.id);
    return toast(t('fluid.removed'), t('common.undo'), () => S.restoreFood(entry));
  }

  if (el.id === 'pSave') {
    const dry   = readNumber($('#pDry'),   { min: 20,  max: 250,  required: false });
    if (dry === null) return $('#pDry').focus();
    const allow = readNumber($('#pAllow'), { min: 200, max: 3000, required: false });
    if (allow === null) return $('#pAllow').focus();
    const idwg  = readNumber($('#pIdwg'),  { min: 0.5, max: 6,    required: false });
    if (idwg === null) return $('#pIdwg').focus();
    const kLim  = readNumber($('#pK'),     { min: 500, max: 5000, required: false });
    if (kLim === null) return $('#pK').focus();
    const naLim = readNumber($('#pNa'),    { min: 500, max: 5000, required: false });
    if (naLim === null) return $('#pNa').focus();
    const phLim = readNumber($('#pPh'),    { min: 300, max: 3000, required: false });
    if (phLim === null) return $('#pPh').focus();
    const kcalGoal = readNumber($('#pKcal'), { min: 800, max: 5000, required: false });
    if (kcalGoal === null) return $('#pKcal').focus();
    const proteinGoal = readNumber($('#pProtein'), { min: 20, max: 250, required: false });
    if (proteinGoal === null) return $('#pProtein').focus();
    const fiberGoal = readNumber($('#pFiber'), { min: 10, max: 60, required: false });
    if (fiberGoal === null) return $('#pFiber').focus();
    const autoGoals = $('#pAutoGoals')?.checked ?? true;

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
      potassiumLimitMg: kLim ?? 2000,
      sodiumLimitMg: naLim ?? 2300,
      phosphorusLimitMg: phLim ?? 900,
      kcalGoal: kcalGoal ?? 1800,
      proteinGoalG: proteinGoal ?? 60,
      fiberGoalG: fiberGoal ?? 30,
      autoGoalsFromLabs: autoGoals,
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
    if (e.target.id === 'pAutoGoals') {
      // Local-only toggle so the K/phosphorus/protein fields lock or
      // unlock immediately, without forcing a Save round-trip first to
      // see the effect. The lab/dry-weight facts behind whether there's
      // anything to lock to haven't changed, just re-check them against
      // the box's new state.
      const p = S.getProfile();
      const on = e.target.checked;
      const locks = [
        ['#pK',       on && !!S.recommendedPotassiumRangeFromLab(p)],
        ['#pPh',      on && !!S.recommendedPhosphorusRangeFromLab(p)],
        ['#pProtein', on && !!p.dryWeightKg]
      ];
      locks.forEach(([sel, locked]) => { const el = $(sel); if (el) el.disabled = locked; });
      return;
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
