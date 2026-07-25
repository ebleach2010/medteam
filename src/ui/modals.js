import { generateScan } from '../render/xray.js';
import { askPatient, talkDown, orderTreatment, judgeDx, medDocConsult, consultStaff, CONSULT_ROLES, parsePage, llmEnabled, getKey, setKey, getModel, setModel, MODELS,
  askAdam, openaiEnabled, setOpenAIKey, getAdamLog, appendAdamLog, clearAdamLog } from '../sim/llm.js';
import { MEDS, SHELVES } from '../data/meds.js';
import { PANELS, filterLabs } from '../data/labs.js';
import { spawnCarryable } from '../entities/Carryable.js';
import { ekgPath } from './monitor.js';
import { settings, saveSettings, keyLabel, DEFAULT_KEYS } from '../core/settings.js';
import { parseStudy } from '../data/studies.js';

// fuzzy pick from a {id,label} menu by typed text: score by how much of the
// text the label covers and vice versa ("ct with contrast" → CT + contrast)
function pickByText(list, text) {
  const norm = (s) => ` ${s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const t = norm(text ?? '');
  if (t.trim() === '') return null;
  const tWords = t.trim().split(' ');
  let best = null, bs = 0;
  for (const m of list) {
    const l = norm(m.label + ' ' + m.id);
    const lWords = norm(m.label).trim().split(' ');
    const cover = tWords.filter((w) => l.includes(` ${w} `)).length / tWords.length;
    const back = lWords.filter((w) => t.includes(` ${w} `)).length / lWords.length;
    const s = cover + back;
    if (s > bs) { bs = s; best = m; }
  }
  return bs >= 0.6 ? best : null;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SHELF_NAMES = {
  topicals: 'Topicals', antibiotics: 'Antibiotics', resp: 'Resp/Allergy',
  cardiac: 'Cardiac', critical: 'Critical', sedation: 'Sedation/Pain',
};

// One modal system, several bodies: lab printout, imaging interpretation,
// diagnosis picker. Options resolve through SELECT intents so tests (and
// future co-op) drive them exactly like thumbs do.
export class Modals {
  constructor(root, game) {
    this.game = game;
    this.veil = document.createElement('div');
    this.veil.id = 'modal-veil';
    this.veil.innerHTML = '<div id="modal"></div>';
    root.appendChild(this.veil);
    this.box = this.veil.querySelector('#modal');
    this.current = null; // { type, options, onPick, patient }
  }

  get open() { return !!this.current; }

  // every modal body raises itself through here, so the whoosh (and the key
  // clicks on whatever input it contains) get wired in exactly once
  _open() {
    if (this.veil.style.display !== 'flex') this.game.audio?.open?.();
    this.veil.style.display = 'flex';
    if (!this._typeWired) {
      this._typeWired = true;
      this.veil.addEventListener('keydown', (e) => {
        if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return;
        if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') this.game.audio?.type?.();
      });
    }
  }

  // results show ONLY the panels that were ordered — a test never sent never
  // the lab printout body (also reused by the folder-tabbed reports view)
  _labsHtml(patient) {
    const sim = patient.sim, c = sim.case;
    const ordered = sim.orderedPanels ?? PANELS.map((p) => p.id);
    const { rows } = filterLabs(c.labs, ordered);
    const lines = [];
    for (const p of PANELS) {
      if (!ordered.includes(p.id)) continue;
      const mine = rows.filter((r) => r.panel === p.id);
      lines.push(`── ${p.label.toUpperCase()} ──`);
      if (mine.length) for (const r of mine) lines.push(`${r.key.padEnd(15)} ${/[A-Z]{3}/.test(r.value) ? `<b>${r.value}</b>` : r.value}`);
      else lines.push('  no acute findings');
    }
    const skipped = PANELS.filter((p) => !ordered.includes(p.id)).map((p) => p.id).join(', ');
    if (skipped) lines.push('', `NOT ORDERED: ${skipped}`);
    return `<div class="paper">MEDTEAM GENERAL LABORATORY\n------------------------\n${c.labs === null ? 'No labs indicated for this presentation.' : lines.join('\n')}</div>`;
  }

  labResults(patient) { this.reports(patient, 'labs'); }

  // 🗂 the patient's chart folder: every report on file (labs / imaging /
  // specialist consults) as tabbed Manila envelopes. Tapping a tab shuffles
  // the current folder to the back and flips the selected one to the front.
  reports(patient, wantTab) {
    const sim = patient.sim;
    const tabs = [];
    if (sim.labState === 'ready' || sim.labState === 'read') {
      tabs.push({ key: 'labs', label: 'LAB WORK', render: () => this._labsHtml(patient) });
    }
    if (sim.imagingReport) {
      const r = sim.imagingReport;
      tabs.push({ key: 'imaging', label: 'IMAGING', render: () =>
        `${r.img ? `<img class="scan" src="${r.img}">` : ''}<div class="paper">${esc(r.text)}</div>` });
    }
    (sim.consultReports ?? []).forEach((c, i) => tabs.push({
      key: 'consult' + i, label: c.specialty.toUpperCase(),
      render: () => `<div class="paper"><b>${esc(c.specialty)} consult</b>\n\n${esc(c.text)}</div>`,
    }));
    if (!tabs.length) { this.game.ui.toast('No reports on file for this patient yet.'); return; }

    this.current = { type: 'reportview', patient, options: [] };
    this.box.classList.add('folders');
    let active = tabs.find((t) => t.key === wantTab) ? wantTab : tabs[0].key;
    const paint = (flip) => {
      const cur = tabs.find((t) => t.key === active) ?? tabs[0];
      this.box.innerHTML = `<h3 style="color:#f0e6cf">🗂 Chart — ${esc(sim.displayName)}</h3>
        <div class="foldertabs">${tabs.map((t) =>
          `<button class="ftab${t.key === active ? ' on' : ''}" data-t="${t.key}">${t.label}</button>`).join('')}</div>
        ${tabs.length > 1 ? '<div class="folderback"></div>' : ''}
        <div class="folder${flip ? ' flip' : ''}"><h4>${cur.label}</h4>${cur.render()}</div>
        <button class="close" style="background:#c7ad76;color:#4a3a1c">Close chart</button>`;
      this.box.querySelectorAll('.ftab').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.t === active) return;
        active = b.dataset.t;
        paint(true); // flip the newly-selected folder to the front
      }));
      this.box.querySelector('.close').addEventListener('click', () => this.close());
    };
    paint(false);
    this._open();
    // reviewing labs still counts as read (score + it stops the pester)
    if (sim.labState === 'ready') { sim.labState = 'read'; this.game.addScore(20, 'Labs reviewed'); }
  }

  // 🧪 the phlebotomist's order board: toggle panels, then SEND. Used both at
  // the bedside DRAW BLOOD and when the aide waits for your order.
  labPick(ctx) {
    this.current = { type: 'labs_order', patient: ctx.patient, options: [], task: ctx.task ?? null };
    let body = `<h3>🧪 Order labs — ${ctx.patient.sim.displayName}</h3>
      <p style="color:#8a7a55;font-size:11px;margin:2px 0 6px">Tap the panels you want, then SEND. Anything you don't order never comes back.</p>`;
    for (const p of PANELS) {
      body += `<button class="opt ptoggle" data-p="${p.id}"><span class="tick">☐</span> ${p.label}</button>`;
    }
    body += `<button class="opt" id="sendlabs" style="font-weight:800">🩸 SEND ORDER</button>
      <button class="close">Not yet</button>`;
    this.box.innerHTML = body;
    this._open();
    this.box.querySelectorAll('.ptoggle').forEach((b) =>
      b.addEventListener('click', () => {
        b.classList.toggle('on');
        b.querySelector('.tick').textContent = b.classList.contains('on') ? '☑' : '☐';
      }));
    this.box.querySelector('#sendlabs').addEventListener('click', () => {
      const panels = [...this.box.querySelectorAll('.ptoggle.on')].map((b) => b.dataset.p);
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'labs_order', choice: panels } });
    });
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // 📟 fullscreen vitals — opened by tapping a room's wall monitor card
  vitalsFull(pt) {
    this.current = { type: 'vitalsfull', patient: pt, options: [] };
    const render = () => {
      const sim = pt.sim, v = sim.vitals();
      const dead = sim.state === 'dead';
      this.box.innerHTML = `<h3>📟 ${sim.displayName} — ${dead ? 'DECEASED' : sim.case.name}</h3>
        <div class="monfull${sim.alarming() ? ' alarm' : ''}">
          <div class="vrow"><span>HR</span><b>${v.hr}</b><span>SpO₂</span><b>${v.spo2}%</b></div>
          <div class="vrow"><span>BP</span><b>${v.sbp}/${v.dbp}</b><span>RR</span><b>${v.rr}</b></div>
          <div class="vrow"><span>TEMP</span><b>${v.temp}°C</b><span></span><b></b></div>
          ${sim.case.ekg ? `<div class="ekgnote">${sim.case.ekg}</div>` : ''}
          <svg class="bigekg" viewBox="0 0 100 20" preserveAspectRatio="none">
            <path d="${ekgPath(dead ? 0 : v.hr)}" fill="none" stroke="#38e08f" stroke-width="0.9"/></svg>
        </div>
        <div class="paper">COMPLAINT: "${sim.case.complaint[0]}"\nSTATE: ${sim.state}${sim.treated ? ' · treated' : ''}${sim.critical ? ' · <b>CRITICAL</b>' : ''}</div>
        <button class="close">Close</button>`;
      this.box.querySelector('.close').addEventListener('click', () => this.close());
    };
    render();
    this._open();
    clearInterval(this._vfT);
    this._vfT = setInterval(() => {
      if (this.current?.type === 'vitalsfull') render();
      else clearInterval(this._vfT);
    }, 800);
  }

  imaging(patient) {
    const img = patient.sim.case.imaging;
    const url = generateScan(img.type, patient.sim.scanSeed);
    this._show({
      type: 'imaging', patient, options: img.options,
      html: `<h3>📷 Interpret the scan — ${patient.sim.displayName}</h3><img class="scan" src="${url}">`,
      closable: false,
    });
  }

  // the med cabinet: tabbed by class, pick a med to take it in hand
  cabinet(tab = 'antibiotics') {
    this.current = { type: 'cabinet', patient: null, options: [] };
    const tabs = SHELVES.map((s) =>
      `<button class="tab${s === tab ? ' on' : ''}" data-tab="${s}">${SHELF_NAMES[s]}</button>`).join('');
    const meds = MEDS.filter((m) => m.shelf === tab).map((m) =>
      `<button class="opt medbtn" data-med="${m.id}">
         <i style="background:#${m.color.toString(16).padStart(6, '0')}"></i>${m.name}</button>`).join('');
    this.box.innerHTML = `<h3>💊 Med cabinet</h3><div class="tabs">${tabs}</div>${meds}
      <button class="close">Close</button>`;
    this._open();
    this.box.querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('click', () => this.cabinet(b.dataset.tab)));
    this.box.querySelectorAll('.medbtn').forEach((b) =>
      b.addEventListener('click', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'cabinet', choice: b.dataset.med } })));
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // the clipboard: chart + bedside workups (EKG / physical / neuro) + diagnose
  workup(patient) {
    const sim = patient.sim, c = sim.case;
    sim.chartSeen = true;
    const w = sim.workups;
    const lines = [
      `PATIENT        ${sim.displayName}, ${sim.age}`,
      `COMPLAINT      "${c.complaint[0]}"`,
      `HISTORY        ${c.history ?? 'Unremarkable'}`,
      w.ekg ? `EKG            ${c.ekg ? `<b>${c.ekg}</b>` : 'Normal sinus rhythm'}` : null,
      w.phys ? `PHYSICAL       ${c.physical ? `<b>${c.physical}</b>` : 'Unremarkable exam'}` : null,
      w.neuro ? `NEURO          ${c.neuro ? `<b>${c.neuro}</b>` : 'Grossly intact'}` : null,
      sim.labState === 'read' ? 'LABS           on file (see printout)' : null,
      sim.imagingDone ? 'IMAGING        done (interpreted)' : null,
    ].filter(Boolean).join('\n');
    this.current = { type: 'workup', patient, options: [] };
    this.box.innerHTML = `<h3>📋 Chart — ${sim.displayName}</h3>
      <div class="paper">MEDTEAM GENERAL — INTAKE\n------------------------\n${lines}</div>
      <div class="txrow"><input id="askbar" placeholder="Ask the patient anything..." /><button class="opt go-mini" data-w="ask">💬</button></div>
      <div class="txrow"><input id="treatbar" placeholder="Order ANYTHING (wrap ankle, CPR, juice...)" /><button class="opt go-mini" data-w="treat">💊</button></div>
      <div class="llmchip${llmEnabled() ? ' on' : ''}">${llmEnabled() ? '● LIVE CLAUDE — real conversation' : '○ OFFLINE MATCHER — connect your API key (🔑 title screen / MED-DOC) for real conversation. NOTE: blocked inside the claude.ai artifact.'}</div>
      ${(sim.chatLog ?? []).slice(-3).map((e) => `<div class="chatline"><b>You:</b> ${esc(e.q)}<br><b>${sim.displayName}:</b> ${esc(e.a)}</div>`).join('')}
      <button class="opt" data-w="ekg">🫀 Run EKG ${w.ekg ? '✓' : ''}</button>
      <button class="opt" data-w="phys">🩺 Physical exam ${w.phys ? '✓' : ''}</button>
      <button class="opt" data-w="neuro">🧠 Neuro exam ${w.neuro ? '✓' : ''}</button>
      ${sim.case.labs ? `<button class="opt" data-w="labs">🩸 Order labs ${
        sim.labState === 'read' || sim.labState === 'ready' ? '✓'
        : sim.labState !== 'none' ? '…drawing' : ''}</button>` : ''}
      ${(sim.labState === 'ready' || sim.labState === 'read' || sim.imagingReport || (sim.consultReports ?? []).length)
        ? '<button class="opt" data-w="chart">🗂 Open chart folder (labs · imaging · consults)</button>' : ''}
      <button class="opt" data-w="dx">✅ Diagnose</button>
      <button class="close">Close</button>`;
    this._open();
    this.box.querySelectorAll('.opt').forEach((b) =>
      b.addEventListener('click', (ev) => {
        const w2 = b.dataset.w;
        if (w2 === 'labs') { ev.preventDefault(); this.labPick({ patient }); return; }
        if (w2 === 'chart') { ev.preventDefault(); this.reports(patient); return; }
        if (w2 === 'ask' || w2 === 'treat') {
          ev.preventDefault();
          const input = this.box.querySelector(w2 === 'ask' ? '#askbar' : '#treatbar');
          const text = input?.value ?? '';
          if (!text.trim()) return;
          this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'workup', choice: w2, text } });
          return;
        }
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'workup', choice: w2 } });
      }));
    for (const [sel, w] of [['#askbar', 'ask'], ['#treatbar', 'treat']]) {
      this._wireTyped(sel, null, (text) => // button taps handled by the .opt loop above
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'workup', choice: w, text } }));
    }
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // the tech's board: every study on the menu, or type what you want and
  // confirm with the ✅ — typing NEVER closes or submits this by accident
  studyPick(task) {
    this.current = { type: 'study', patient: task.patient, options: [], task };
    // you order a study OF something — modality alone isn't an order
    const common = ['X-ray chest', 'X-ray ankle', 'CT head', 'CT abdomen w/ contrast',
      'Ultrasound abdomen', '12-lead EKG', 'MRI head', 'CTA chest'];
    let body = `<h3>📷 Order a study — ${task.patient.sim.displayName}</h3>
      <p style="color:#8a7a55;font-size:11px;margin:2px 0 6px">Write it like a real request: modality <b>and</b> body part.
        “x-ray foot”, “CT head w/o contrast”, “MRI w/ w/o contrast of head, neck and spine”.</p>
      <div class="txrow"><input id="studybar" placeholder="e.g. x-ray left ankle" /><button class="opt go-mini" id="studygo">✅</button></div>
      <div id="studyecho" style="font-size:11px;color:#6b7f5a;min-height:15px;margin:2px 0 6px"></div>
      <p style="color:#8a7a55;font-size:11px;margin:2px 0 6px">...or tap a common one:</p>`;
    for (const c of common) body += `<button class="opt" data-q="${c}">${c}</button>`;
    body += '<button class="close">Not yet</button>';
    this.box.innerHTML = body;
    this._open();
    // live echo of how the order parses, so it's obvious what you're asking for
    const bar = this.box.querySelector('#studybar');
    const echo = this.box.querySelector('#studyecho');
    bar?.addEventListener('input', () => {
      const r = parseStudy(bar.value);
      echo.textContent = bar.value.trim() ? (r.ok ? `→ ${r.label} (${r.t}s)` : `→ ${r.why}`) : '';
      echo.style.color = r.ok ? '#4a7a3a' : '#a06a3a';
    });
    this.box.querySelectorAll('.opt[data-q]').forEach((b) =>
      b.addEventListener('click', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'study', text: b.dataset.q } })));
    this._wireTyped('#studybar', '#studygo', (text) =>
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'study', text } }));
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // the surgeon's board — a big categorised menu you tap, plus a live filter.
  // No more guessing the exact phrase: pick "Kidney stone removal" from Urology
  // instead of typing it and hoping.
  surgeryPick(task) {
    const G = this.game.constructor;
    this.current = { type: 'surgery', patient: task.patient, options: [], task };
    const cats = G.SURGERY_CATS;
    const norm = (s) => s.toLowerCase();
    const tabs = `<button class="tab on" data-cat="all">All</button>` +
      cats.map((c) => `<button class="tab" data-cat="${c.id}">${c.label}</button>`).join('');
    const rows = G.SURGERIES.map((s) =>
      `<button class="opt surgrow" data-s="${s.id}" data-cat="${s.cat}" data-l="${norm(s.label)}">${
        s.label} <span style="float:right;color:#8a7a55">${s.t}s</span></button>`).join('');
    this.box.innerHTML = `<h3>🔪 Choose the operation — ${esc(task.patient.sim.displayName)}</h3>
      <div class="txrow"><input id="surgbar" autocomplete="off" placeholder="Filter operations..." /><button class="opt go-mini" id="surggo">✅</button></div>
      <div id="surgnote" style="min-height:14px;font-size:11px;color:#a0552c;margin:2px 0"></div>
      <div class="tabs">${tabs}</div>
      <div class="surglist" id="surglist">${rows}</div>
      <button class="close">Not yet</button>`;
    this._open();

    let cat = 'all', filter = '';
    const list = this.box.querySelector('#surglist');
    const note = this.box.querySelector('#surgnote');
    const apply = () => {
      const words = filter.split(/\s+/).filter(Boolean);
      let shown = 0;
      list.querySelectorAll('.surgrow').forEach((b) => {
        const okCat = cat === 'all' || b.dataset.cat === cat;
        const okText = !words.length || words.every((w) => b.dataset.l.includes(w));
        const vis = okCat && okText;
        b.style.display = vis ? '' : 'none';
        if (vis) shown++;
      });
      note.textContent = shown ? '' : `No operation matches “${filter}”. Try another tab or term.`;
      return shown;
    };
    const pick = (id) => this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'surgery', choice: id } });

    this.box.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      cat = b.dataset.cat; filter = '';
      this.box.querySelector('#surgbar').value = '';
      this.box.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === b));
      apply();
    }));
    list.querySelectorAll('.surgrow').forEach((b) =>
      b.addEventListener('click', () => pick(b.dataset.s)));
    // live filter — no re-render, so the keyboard/focus survives each keystroke
    const bar = this.box.querySelector('#surgbar');
    bar.addEventListener('input', () => { filter = norm(bar.value.trim()); apply(); });
    // the ✅ (or Enter) commits the top visible match; empty → a visible note
    this._wireTyped('#surgbar', '#surggo', () => {
      const first = [...list.querySelectorAll('.surgrow')].find((b) => b.style.display !== 'none');
      if (first) pick(first.dataset.s);
      else { note.textContent = 'Nothing matches — pick an operation from a tab.'; }
    });
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // text bars submit ONLY via their ✅ button (or a deliberate Enter);
  // keystrokes are fenced off from the game's hotkeys
  // Wire a text input so a SINGLE keystroke sends: the iOS keyboard shows a
  // blue "Send" key (enterkeyhint), and pressing it (or Enter) submits and
  // keeps the keyboard up for chat-style modals — no checkmark-then-send dance.
  _wireTyped(inputSel, btnSel, submit, { keepFocus = true } = {}) {
    const input = this.box.querySelector(inputSel);
    if (input) {
      input.setAttribute('enterkeyhint', 'send');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocorrect', 'off');
    }
    const go = () => {
      const t = input?.value ?? '';
      if (!t.trim()) return;
      submit(t);
      if (keepFocus && input && document.body.contains(input)) input.focus();
    };
    if (btnSel) this.box.querySelector(btnSel)?.addEventListener('click', go);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      e.stopPropagation();
    });
  }

  // clipboard rises up with the imaging report
  report(clip) {
    const r = clip.data.report ?? { text: 'No report attached.', img: null };
    this.current = { type: 'reportview', patient: null, options: [] };
    this.box.innerHTML = `<h3>📋 Radiology report</h3>
      ${r.img ? `<img class="scan" src="${r.img}">` : ''}
      <div class="paper">${r.text}</div>
      <button class="close">Close</button>`;
    this.box.classList.add('rise');
    setTimeout(() => this.box.classList.remove('rise'), 500);
    this._open();
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // typed de-escalation for the angry
  talk(patient) {
    const sim = patient.sim;
    this.current = { type: 'talk', patient, options: [] };
    this.box.innerHTML = `<h3>😡 ${sim.displayName} is furious</h3>
      <div class="paper">${(sim.talkLog ?? ['"' + (sim.lastCurse ?? 'THIS PLACE IS A JOKE!') + '"']).slice(-3).join('\n')}</div>
      <div class="txrow"><input id="talkbar" placeholder="Say something calming..." /><button class="opt go-mini" data-t="1">💬</button></div>
      <button class="close">Walk away</button>`;
    this._open();
    this._wireTyped('#talkbar', '[data-t]', (text) =>
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'talk', text } }));
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  diagnose(patient) {
    const c = patient.sim.case;
    const hints = [];
    if (patient.sim.labState === 'read') hints.push('labs seen');
    if (patient.sim.imagingDone) hints.push('imaging done');
    // shuffle the display order (seeded per patient) — buttons carry the
    // ORIGINAL index so correctDx stays 0 for the sim and the tests
    const order = c.dxOptions.map((_, i) => i);
    let s = patient.sim.scanSeed;
    for (let i = order.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = s % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.current = { type: 'dx', patient, options: c.dxOptions };
    let body = `<h3>✅ Diagnosis — ${patient.sim.displayName}</h3>
      <p style="color:#a9bce0;font-size:12px;margin-bottom:8px">
        Complaint: “${c.complaint[0]}” ${hints.length ? `· ${hints.join(' · ')}` : '· no workup yet 😬'}</p>
      <div class="txrow"><input id="dxbar" placeholder="Type your diagnosis..." /><button class="opt go-mini" id="dxgo">✅</button></div>
      <p style="color:#6e7f9e;font-size:11px;margin:4px 0 8px">...or pick from the differential:</p>`;
    for (const i of order) body += `<button class="opt" data-i="${i}">${c.dxOptions[i]}</button>`;
    body += '<button class="close">Close</button>';
    this.box.innerHTML = body;
    this._open();
    this.box.querySelectorAll('.opt[data-i]').forEach((b) =>
      b.addEventListener('click', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'dx', choice: +b.dataset.i } })));
    this._wireTyped('#dxbar', '#dxgo', (text) =>
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'dx', text } }));
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  _show({ type, patient, options, html, closable }) {
    this.current = { type, patient, options };
    let body = html;
    options.forEach((o, i) => { body += `<button class="opt" data-i="${i}">${o}</button>`; });
    if (closable) body += '<button class="close">Close</button>';
    this.box.innerHTML = body;
    this._open();
    this.box.querySelectorAll('.opt').forEach((b) =>
      b.addEventListener('click', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: type, choice: +b.dataset.i } })));
    this.box.querySelector('.close')?.addEventListener('click', () => this.close());
  }

  // 📟 call a specialist consult: pick the specialty and a real physician walks
  // into the ED, evaluates the patient for ~30s, and leaves a note in the chart.
  consultPick(patient) {
    const g = this.game;
    const sim = patient.sim;
    this.current = { type: 'consultpick', patient, options: [] };
    if (sim.consultPending) {
      this.box.innerHTML = `<h3>📟 Consult</h3>
        <div class="paper">${esc(sim.consultPending)} is already on the way to ${sim.bed ? 'Room ' + sim.bed.roomNo : 'this patient'}.
They'll evaluate at the bedside and file a note in the chart.</div>
        <button class="close">OK</button>`;
      this._open();
      this.box.querySelector('.close').addEventListener('click', () => this.close());
      return;
    }
    let body = `<h3>📟 Call a specialist — ${esc(sim.displayName)}</h3>
      <p style="color:#6e7f9e;font-size:11px;margin:2px 0 8px">They walk in, evaluate at the bedside (~30s), and leave a consult note in the chart.</p>`;
    for (const s of g.constructor.SPECIALTIES) body += `<button class="opt" data-spec="${esc(s.label)}">🩺 ${s.label}</button>`;
    body += '<button class="close">Cancel</button>';
    this.box.innerHTML = body;
    this._open();
    this.box.querySelectorAll('[data-spec]').forEach((b) => b.addEventListener('click', () => {
      g.orderConsult(patient, b.dataset.spec);
      this.close();
    }));
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // 🗣 curbside consult: pick which staff member to grill about this patient.
  // Live Claude answers in role with the chart; offline gives role summaries.
  consult(patient, role = 'nurse') {
    const g = this.game;
    const sim = patient.sim;
    this.current = { type: 'consult', patient, options: [] };
    patient._consultLog ??= [];
    const roleDef = CONSULT_ROLES.find((r) => r.id === role) ?? CONSULT_ROLES[0];
    const tabs = CONSULT_ROLES.map((r) =>
      `<button class="tab${r.id === role ? ' on' : ''}" data-role="${r.id}">${r.ico} ${r.label}</button>`).join('');
    this.box.innerHTML = `<h3>🗣️ Consult — ${sim.displayName}${sim.bed ? ` (Room ${sim.bed.roomNo})` : ''}</h3>
      <div class="tabs">${tabs}</div>
      <div class="paper" id="clog" style="max-height:34vh;overflow-y:auto">${patient._consultLog.map((l) =>
        l.who === 'you' ? `<b>YOU:</b> ${esc(l.text)}` : `<b>${esc(l.role.toUpperCase())}:</b> ${esc(l.text)}`).join('\n') || `Ask the ${roleDef.label.toLowerCase()} anything about this patient.`}</div>
      <div class="txrow"><input id="conbar" autocomplete="off" placeholder="Ask the ${roleDef.label.toLowerCase()}..." /><button class="opt go-mini" id="congo">💬</button></div>
      <button class="close">Done</button>`;
    this._open();
    this.box.querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('click', () => this.consult(patient, b.dataset.role)));
    const logEl = this.box.querySelector('#clog');
    const paint = () => {
      logEl.innerHTML = patient._consultLog.map((l) =>
        l.who === 'you' ? `<b>YOU:</b> ${esc(l.text)}` : `<b>${esc(l.role.toUpperCase())}:</b> ${esc(l.text)}`).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    };
    const input = this.box.querySelector('#conbar');
    this._wireTyped('#conbar', '#congo', async (text) => {
      const t = text.trim();
      if (!t) return;
      input.value = '';
      patient._consultLog.push({ who: 'you', text: t });
      const pending = { who: 'staff', role: roleDef.label, text: '...' };
      patient._consultLog.push(pending);
      paint();
      const reply = await consultStaff(g, patient, role, t);
      pending.text = reply;
      if (this.current?.type === 'consult') paint();
    });
    setTimeout(() => input?.focus(), 50);
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // 📟 page the nurse: freeform orders — meds to a room, walk someone to
  // discharge, go assess and report back. Parsed live by Claude when keyed.
  pager() {
    const g = this.game;
    this.current = { type: 'pager', patient: null, options: [] };
    g.pagerLog ??= [{ who: 'nurse', text: 'Pager\'s on, doctor. Tell me what you need — meds to a room, walk someone out, or eyes on a patient.' }];
    this.box.innerHTML = `<h3>📟 Page the nurse</h3>
      <div class="paper" id="plog" style="max-height:32vh;overflow-y:auto"></div>
      <p style="color:#6e7f9e;font-size:11px;margin:4px 0 6px">e.g. "give amoxicillin to room 3" · "discharge room 2" · "check on room 5 and report back"</p>
      <div class="txrow"><input id="pagebar" autocomplete="off" placeholder="Page her anything..." /><button class="opt go-mini" id="pagego">📟</button></div>
      <button class="close">Close</button>`;
    this._open();
    const logEl = this.box.querySelector('#plog');
    const paint = () => {
      logEl.innerHTML = g.pagerLog.slice(-6).map((l) =>
        l.who === 'you' ? `<b>YOU:</b> ${esc(l.text)}` : `<b>RN:</b> ${esc(l.text)}`).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    };
    paint();
    const input = this.box.querySelector('#pagebar');
    this._wireTyped('#pagebar', '#pagego', async (text) => {
      const t = text.trim();
      if (!t) return;
      input.value = '';
      g.pagerLog.push({ who: 'you', text: t });
      const pending = { who: 'nurse', text: '...' };
      g.pagerLog.push(pending);
      paint();
      const parsed = await parsePage(g, t);
      pending.text = g.executePage(parsed, t);
      if (this.current?.type === 'pager') paint();
    });
    setTimeout(() => input?.focus(), 50);
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // 🗂 TRIAGE BOARD — the blue CRT: every room, who's in it, how long
  // they've been in the ED, and their basic vitals. Refreshes live.
  triageBoard() {
    const g = this.game;
    this.current = { type: 'triage', patient: null, options: [] };
    this.box.classList.add('crtbox', 'blue');
    const render = () => {
      const now = g.clock.minutes;
      const pts = [...g.world.byTag('patients')];
      const rows = g.map.beds.map((bed) => {
        const p = pts.find((q) => q.sim.bed === bed);
        if (!p) return `R${String(bed.roomNo).padStart(2)}  — empty —`;
        const sim = p.sim, v = sim.vitals();
        const mins = Math.max(0, Math.round(now - sim.tArrive));
        const st = sim.state === 'dead' ? '☠ DECEASED'
          : sim.critical ? '‼ CRITICAL'
          : sim.stabilized ? '✔ STABLE'
          : sim.treated ? '↗ RESPONDING'
          : sim.imagingOrder?.phase === 'queued' || sim.labState === 'queued' ? '◔ QUEUED'
          : sim.labsPending ? '… LABS OUT'
          : '• WORKUP';
        return `R${String(bed.roomNo).padStart(2)}  ${sim.displayName.padEnd(12).slice(0, 12)} ${st.padEnd(12)} ${String(mins).padStart(3)}min  HR ${String(v.hr).padStart(3)}  ${String(v.sbp).padStart(3)}/${String(v.dbp).padEnd(3)}  ${v.spo2}%`;
      });
      const waiting = pts.filter((q) => !q.sim.bed && !q.sim.resolved && q.sim.state !== 'dead').length;
      this.box.innerHTML = `<h3>🗂 TRIAGE BOARD</h3>
        <div class="crt-log" style="max-height:56vh">${rows.map(esc).join('\n')}\n\nWAITING ROOM: ${waiting} not yet roomed</div>
        <button class="close">STAND UP</button>`;
      this.box.querySelector('.close').addEventListener('click', () => this._medDocLeave());
    };
    render();
    this._open();
    clearInterval(this._vfT);
    this._vfT = setInterval(() => {
      if (this.current?.type === 'triage') render();
      else clearInterval(this._vfT);
    }, 1000);
  }

  // 🖥 MED-DOC 4000 — the coin-op consult terminal at the station.
  //
  // It's an arcade cabinet. Five gold cross coins buys a session; the machine
  // takes three seconds to boot, then you can ask it as much as you like until
  // you stand up. Walk away and the credit's gone — sitting back down costs
  // another five. Coins come from patients you got RIGHT, so the terminal is
  // funded by good medicine rather than by asking it what to do.
  medDoc() {
    const g = this.game;
    if (g.medDocSession === 'live') { this._medDocTerminal(); return; }
    this._medDocInsert();
  }

  // ── screen 1: INSERT COINS TO PLAY ──
  _medDocInsert() {
    const g = this.game;
    const have = g.coins ?? 0;
    this.current = { type: 'meddoc', patient: null, options: [] };
    this.box.classList.add('crtbox');
    this.box.classList.remove('errbox');
    this.box.innerHTML = `<h3>▓ MED-DOC 4000</h3>
      <div class="arcade">
        <div class="big">MED-DOC 4000</div>
        <div class="credit">CREDIT: ${have} COIN${have === 1 ? '' : 'S'} · 5 PER SESSION</div>
        <div class="blink">INSERT COINS TO PLAY</div>
        <button class="slot" id="slotbtn">INSERT 5 COINS</button>
        <div class="hint">Coins come from patients you treat correctly and send home.<br>
          Stand up and the session ends — you pay again next time.</div>
      </div>
      <button class="close">STEP AWAY</button>`;
    this._open();
    this.box.querySelector('#slotbtn').addEventListener('click', () => {
      if (!g.spendCoins(5)) { this._medDocError(); return; }
      g.audio?.insertCoin?.();
      this._medDocBoot();
    });
    this.box.querySelector('.close').addEventListener('click', () => this._medDocLeave());
  }

  // ── screen 2: not enough coins — the tube goes red and shouts ──
  _medDocError() {
    const g = this.game;
    g.audio?.reject?.();
    this.current = { type: 'meddoc', patient: null, options: [] };
    this.box.classList.add('crtbox', 'errbox');
    this.box.innerHTML = `<h3>▓ MED-DOC 4000</h3>
      <div class="arcade">
        <div class="big">✖ INSUFFICIENT CREDIT ✖</div>
        <div class="credit">YOU HAVE ${g.coins ?? 0} · YOU NEED 5</div>
        <div class="blink">GO TREAT SOMEBODY</div>
        <div class="hint">Every patient you diagnose, treat and discharge in good shape<br>
          drops one gold cross coin.</div>
      </div>
      <button class="close">STEP AWAY</button>`;
    this._open();
    this.box.querySelector('.close').addEventListener('click', () => this._medDocLeave());
    // the machine sulks for a few seconds, then goes back to attract mode
    clearTimeout(this._arcT);
    this._arcT = setTimeout(() => {
      if (this.current?.type === 'meddoc') this._medDocInsert();
    }, 3200);
  }

  // ── screen 3: three seconds of 1980s POST ──
  _medDocBoot() {
    const g = this.game;
    g.audio?.boot?.();
    this.current = { type: 'meddoc', patient: null, options: [] };
    this.box.classList.add('crtbox');
    this.box.classList.remove('errbox');
    this.box.innerHTML = `<h3>▓ MED-DOC 4000</h3>
      <div class="arcade">
        <div class="credit">CREDIT ACCEPTED — 5 COINS</div>
        <div class="bootbar"><i></i></div>
        <div class="bootlog" id="bootlog"></div>
      </div>`;
    this._open();
    const lines = [
      'MED-DOC 4000 · BIOS 2.7',
      'MEMORY TEST ......... 640K OK',
      'DISK 0 .............. READY',
      'LOADING FORMULARY ... OK',
      'LOADING PATHWAYS .... OK',
      'ESTABLISHING LINK ...',
      llmEnabled() ? `LINK ● LIVE — ${getModel()}` : 'LINK ○ OFFLINE (local index)',
      'READY.',
    ];
    const el = this.box.querySelector('#bootlog');
    let i = 0;
    clearInterval(this._bootT);
    this._bootT = setInterval(() => {
      if (this.current?.type !== 'meddoc') { clearInterval(this._bootT); return; }
      el.textContent += lines[i] + '\n';
      g.audio?.type?.();
      if (++i >= lines.length) clearInterval(this._bootT);
    }, 3000 / lines.length);
    clearTimeout(this._arcT);
    this._arcT = setTimeout(() => {
      if (this.current?.type !== 'meddoc') return;
      g.medDocSession = 'live';
      this._medDocTerminal();
    }, 3050);
  }

  // stepping away from the machine also gets you out of the chair
  _medDocLeave() {
    const g = this.game;
    this.close();
    if (g.active?.seatedAt) g.leaveTerminal(g.active);
  }

  // ── screen 4: the terminal itself ──
  _medDocTerminal() {
    const g = this.game;
    g.medDocLog ??= [{
      who: 'doc',
      text: `MED-DOC 4000 — medical reference terminal.
${llmEnabled() ? `Link: ● live — ${getModel()}.` : 'Link: ○ offline. Type  key <your-anthropic-key>  to bring me online.'}
I answer medical questions. I cannot see your department, your patients or
their charts — ask me about medicine, not about them.
Try: a question, "lookup <diagnosis>", or "clear".`,
    }];
    this.current = { type: 'meddoc', patient: null, options: [] };
    this.box.classList.add('crtbox');
    this.box.classList.remove('errbox');
    this.box.innerHTML = `<h3>▓ MED-DOC 4000</h3>
      <div class="crt-log" id="crtlog"></div>
      <div class="txrow"><span class="crt-ps">C:\\&gt;</span><input id="crtbar" autocomplete="off" spellcheck="false" placeholder="query..." /><button class="opt go-mini crt-go" id="crtgo">⏎</button></div>
      <button class="close">EXIT</button>`;
    this._open();
    const logEl = this.box.querySelector('#crtlog');
    const paint = () => {
      logEl.innerHTML = g.medDocLog.map((l) =>
        l.who === 'you' ? `<div class="you">C:\\&gt; ${esc(l.text)}</div>` : `<div>${esc(l.text)}</div>`).join('');
      logEl.scrollTop = logEl.scrollHeight;
    };
    paint();
    const input = this.box.querySelector('#crtbar');
    this._wireTyped('#crtbar', '#crtgo', async (text) => {
      const t = text.trim();
      input.value = '';
      if (/^clear$/i.test(t)) { g.medDocLog = null; this._medDocTerminal(); return; }
      if (/^key\s+\S/i.test(t)) {
        setKey(t.replace(/^key\s+/i, '').trim());
        g.medDocLog.push({ who: 'doc', text: llmEnabled() ? `KEY STORED. LINK: ● LIVE — ${getModel()}` : 'KEY CLEARED. LINK: ○ OFFLINE' });
        paint();
        return;
      }
      g.medDocLog.push({ who: 'you', text: t });
      const pending = { who: 'doc', text: '▮' };
      g.medDocLog.push(pending);
      paint();
      const reply = await medDocConsult(g, t);
      // typewriter it out — Claude "typing" on the CRT, letter by letter
      clearInterval(this._ttT);
      let i = 0;
      this._ttT = setInterval(() => {
        if (this.current?.type !== 'meddoc') { clearInterval(this._ttT); pending.text = reply; return; }
        i += 1;
        pending.text = reply.slice(0, i) + (i < reply.length ? ' ▮' : '');
        paint();
        if (i % 3 === 0 && reply[i - 1] !== ' ') g.audio?.type?.(); // teletype chatter
        if (i >= reply.length) clearInterval(this._ttT);
      }, 45);
    });
    setTimeout(() => input?.focus(), 50);
    // EXIT ends the session — the five coins are spent, and sitting back down
    // starts the whole thing over at INSERT COINS
    this.box.querySelector('.close').addEventListener('click', () => this._medDocLeave());
  }

  // 👀 THE ADAM COMPUTER — a googly-eyed ChatGPT terminal at the station.
  // Runs on the player's own OpenAI key (browser-only). Freezes the ED while
  // you talk. Remembers every session. A secret admin PIN reveals the logs.
  adamComputer() {
    const g = this.game;
    g.paused = true;                       // the whole department holds while you talk
    if (!openaiEnabled()) { this._adamKeyPrompt(); return; }
    this._adamChat();
  }

  _adamHead() {
    // the high-contrast googly face — two wobbling eyes + a green pixel grin
    return `<div class="adamface"><div class="adameyes">
        <span class="geye"><b></b></span><span class="geye"><b></b></span>
      </div><div class="adamgrin"></div></div>`;
  }

  _adamKeyPrompt() {
    this.current = { type: 'adam', patient: null, options: [] };
    this.box.classList.add('crtbox', 'adambox');
    this.box.innerHTML = `<h3>▓ THE ADAM COMPUTER</h3>
      ${this._adamHead()}
      <p class="adammsg">please enter a ChatGPT API key to access the Adam computer</p>
      <div class="txrow"><input id="adamkey" type="password" autocomplete="off" placeholder="sk-..." /><button class="opt go-mini" id="adamkeygo">✅</button></div>
      <button class="close">STAND UP</button>`;
    this._open();
    this._wireTyped('#adamkey', '#adamkeygo', (text) => {
      setOpenAIKey(text);
      if (openaiEnabled()) this._adamChat();
    });
    this.box.querySelector('.close').addEventListener('click', () => this._adamLeave());
  }

  _adamChat() {
    const g = this.game;
    clearInterval(this._ttT);              // stop any in-flight typewriter
    this.current = { type: 'adam', patient: null, options: [] };
    this._adamView = getAdamLog();
    this.box.classList.add('crtbox', 'adambox');
    this.box.classList.remove('adamadmin');
    this.box.innerHTML = `<h3>▓ THE ADAM COMPUTER</h3>
      ${this._adamHead()}
      <div class="crt-log adamlog" id="adamlog"></div>
      <div class="txrow"><span class="crt-ps">&gt;</span><input id="adambar" autocomplete="off" spellcheck="false" placeholder="talk to me, Adam..." /><button class="opt go-mini adam-go" id="adamgo">⏎</button></div>
      <button class="close">STAND UP</button>`;
    this._open();
    const logEl = this.box.querySelector('#adamlog');
    const greetEmpty = !this._adamView.length;
    const paint = () => {
      const rows = this._adamView.length
        ? this._adamView.map((l) => l.role === 'you'
          ? `<div class="you">&gt; ${esc(l.text)}</div>` : `<div>${esc(l.text)}</div>`).join('')
        : '<div class="adamgreet">…hello again, Adam. Pick up where we left off.</div>';
      logEl.innerHTML = rows;
      logEl.scrollTop = logEl.scrollHeight;
    };
    paint();
    const input = this.box.querySelector('#adambar');
    this._wireTyped('#adambar', '#adamgo', async (text) => {
      const t = text.trim();
      input.value = '';
      if (!t) return;
      // the secret admin key — reveals every logged conversation. Any OTHER
      // string of digits is just ignored input, and nothing hints this exists.
      if (t === '410410') { this._adamAdmin(); return; }
      if (/^\d+$/.test(t)) return;          // other bare numbers do nothing
      // a real turn. History = everything BEFORE this line (askAdam appends the
      // new line itself, so don't double it). Persist the user turn now, show it.
      const history = getAdamLog();
      this._adamView = appendAdamLog('you', t);
      paint();
      const reply = await askAdam(history, t);
      // persist the reply IMMEDIATELY so it's never lost (e.g. if you jump to
      // the admin view mid-type); the typewriter is now purely cosmetic.
      this._adamView = appendAdamLog('adam', reply);
      const idx = this._adamView.length - 1;
      if (this.current?.type !== 'adam') return;
      clearInterval(this._ttT);
      let i = 0;
      this._ttT = setInterval(() => {
        if (this.current?.type !== 'adam') { clearInterval(this._ttT); return; }
        i += 1;
        this._adamView[idx] = { role: 'adam', text: reply.slice(0, i) + (i < reply.length ? ' ▮' : '') };
        paint();
        if (i % 3 === 0 && reply[i - 1] !== ' ') g.audio?.type?.();
        if (i >= reply.length) { clearInterval(this._ttT); this._adamView[idx] = { role: 'adam', text: reply }; paint(); }
      }, 45);
    });
    if (greetEmpty) paint();
    setTimeout(() => input?.focus(), 50);
    this.box.querySelector('.close').addEventListener('click', () => this._adamLeave());
  }

  // 🔒 admin: the PIN unlocked the full cross-session log + a CSV export
  _adamAdmin() {
    clearInterval(this._ttT);              // a reply mid-type shouldn't repaint over admin
    const log = getAdamLog();
    this.current = { type: 'adam', patient: null, options: [] };
    this.box.classList.add('crtbox', 'adambox', 'adamadmin');
    this.box.innerHTML = `<h3>▓ ADAM · ADMIN</h3>
      <div class="crt-log adamlog" id="adamlog">${
        log.length ? log.map((l) => {
          const d = new Date(l.t);
          const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          return `<div class="${l.role === 'you' ? 'you' : ''}"><span class="ats">${ts}</span> ${esc(l.role.toUpperCase())}: ${esc(l.text)}</div>`;
        }).join('') : '<div class="adamgreet">No sessions logged yet.</div>'}</div>
      <div class="adamadminrow">
        <button class="opt" id="adamcsv">⤓ Export CSV</button>
        <button class="opt" id="adamwipe">Wipe logs</button>
        <button class="opt" id="adamback">◀ Back</button>
      </div>
      <button class="close">STAND UP</button>`;
    this._open();
    this.box.querySelector('#adamcsv').addEventListener('click', () => this._adamExportCsv());
    this.box.querySelector('#adamwipe').addEventListener('click', () => { clearAdamLog(); this._adamAdmin(); });
    this.box.querySelector('#adamback').addEventListener('click', () => this._adamChat());
    this.box.querySelector('.close').addEventListener('click', () => this._adamLeave());
  }

  _adamExportCsv() {
    const log = getAdamLog();
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [['timestamp', 'iso', 'role', 'text'],
      ...log.map((l) => [l.t, new Date(l.t).toISOString(), l.role, l.text])];
    const csv = rows.map((r) => r.map(q).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'adam-logs.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.game.ui.toast('📤 Logs exported to adam-logs.csv', 'good');
  }

  _adamLeave() {
    const g = this.game;
    this.close();                          // close() clears g.paused
    if (g.active?.seatedAt) g.leaveTerminal(g.active);
  }

  // 🔑 connect the player's own Anthropic API key (stored in localStorage,
  // sent only to api.anthropic.com). Reachable from the title screen.
  apiSettings() {
    this.current = { type: 'api', patient: null, options: [] };
    const on = llmEnabled();
    let body = `<h3>🔑 Live Claude — patient AI</h3>
      <div class="paper">With an Anthropic API key connected, the ASK / TREAT /
TALK-DOWN / DIAGNOSE text bars run through the real Claude API.
Without one, a built-in offline matcher answers instead.

STATUS: ${on ? '<b>CONNECTED</b> — model: ' + getModel() : 'offline matcher'}

NOTE: the claude.ai artifact sandbox blocks all network,
so live Claude only works on the hosted / local build.
Your key stays in this browser only.</div>
      <div class="txrow"><input id="keybar" type="password" placeholder="sk-ant-..." value="${on ? getKey() : ''}" /><button class="opt go-mini" id="keygo">✅</button></div>`;
    for (const m of MODELS) {
      body += `<button class="opt" data-model="${m.id}">${getModel() === m.id ? '●' : '○'} ${m.label}</button>`;
    }
    if (on) body += '<button class="opt" id="keyoff">🗑 Disconnect (forget key)</button>';
    body += '<button class="close">Close</button>';
    this.box.innerHTML = body;
    this._open();
    this._wireTyped('#keybar', '#keygo', (key) => {
      setKey(key.trim());
      this.game.ui.toast(key.trim() ? '🔑 Claude connected' : 'Key cleared', 'good');
      this.apiSettings();
    });
    this.box.querySelectorAll('[data-model]').forEach((b) =>
      b.addEventListener('click', () => { setModel(b.dataset.model); this.apiSettings(); }));
    this.box.querySelector('#keyoff')?.addEventListener('click', () => {
      setKey('');
      this.game.ui.toast('Key forgotten');
      this.apiSettings();
    });
    this.box.querySelector('.close').addEventListener('click', () => this.close());
  }

  // called by Game when a SELECT intent lands
  resolve(choice, actor, text) {
    const cur = this.current;
    if (!cur) return;
    const g = this.game;
    if (cur.type === 'cabinet') {
      g.takeMedFromCabinet(actor ?? g.active, choice);
      this.close();
      return;
    }
    if (cur.type === 'workup') {
      const sim2 = cur.patient.sim;
      if (choice === 'dx') { this.diagnose(cur.patient); return; }
      if (choice === 'ask') {
        // show the question immediately with a pending answer; the reply fills
        // in when Claude (or the local matcher) comes back
        const entry = { q: text, a: '…' };
        (sim2.chatLog ??= []).push(entry);
        this.workup(cur.patient);
        askPatient(sim2, text ?? '').then((a) => {
          entry.a = a;
          g.ui.bubbles.say(cur.patient, a.length > 90 ? a.slice(0, 88) + '…' : a, { hold: 4.5 });
          if (this.current?.type === 'workup' && this.current.patient === cur.patient) this.workup(cur.patient);
        });
        return;
      }
      if (choice === 'treat') {
        // comma-separated orders are a whole prescription: "ativan, trazodone,
        // fluids" is three orders carried out in sequence
        const orders = String(text ?? '').split(/\s*,\s*|\s+then\s+/i)
          .map((s) => s.trim()).filter(Boolean).slice(0, 5);
        g.ui.toast(orders.length > 1
          ? `💊 Processing ${orders.length} orders...` : '💊 Processing the order...');
        (async () => {
          for (const one of orders) {
            const { medId, effect, reply } = await orderTreatment(sim2, one);
            if (medId) g.orderMedFetch(cur.patient, medId);
            else if (effect) g.applyIntervention(cur.patient, effect, reply, one);
            else g.ui.toast(`Staff blink at “${one}”. “...do WHAT, exactly?”`, 'bad');
            if (orders.length > 1) await new Promise((r) => setTimeout(r, 900)); // one at a time
          }
        })();
        this.workup(cur.patient);
        return;
      }
      if (!sim2.workups[choice]) {
        sim2.workups[choice] = true;
        g.addScore(10, 'Workup');
        g.audio.tap();
      }
      this.workup(cur.patient); // re-render with the new finding
      return;
    }
    if (cur.type === 'labs_order') {
      const panels = Array.isArray(choice) ? choice : [];
      if (!panels.length) { g.ui.toast('Pick at least one panel first', 'bad'); return; }
      const sim = cur.patient.sim;
      sim.orderedPanels = panels;
      if (cur.task) {
        if (cur.task.phase === 'awaitChoice' || cur.task.phase === 'toPatient') g.beginLabs(cur.task, panels);
      } else {
        // no phlebotomist en route yet — dispatch one with these panels (you
        // never handle blood yourself; they draw and run it to the lab)
        g.orderLabs(cur.patient, panels);
      }
      this.close();
      return;
    }
    if (cur.type === 'study') {
      // parse the written request: modality + body region(s) + contrast
      const study = parseStudy(text ?? '');
      if (!study.ok) {
        g.ui.toast(`🧑‍⚕️ Tech: “${study.why}”`, 'bad');
        return; // board stays up — refine the order
      }
      cur.task.study = study;
      g.ui.toast(`📷 ${study.label} ordered — rolling to imaging`);
      this.close();
      return;
    }
    if (cur.type === 'surgery') {
      const picked = choice !== undefined
        ? g.constructor.SURGERIES.find((m) => m.id === choice)
        : pickByText(g.constructor.SURGERIES, text);
      if (!picked) {
        g.ui.toast('Surgeon: “that is not an operation.”', 'bad');
        return;
      }
      g.beginSurgery(cur.task, picked);
      g.ui.toast(`🔪 ${picked.label} ordered — rolling to the OR`);
      this.close();
      return;
    }
    if (cur.type === 'talk') {
      const sim3 = cur.patient.sim;
      (sim3.talkLog ??= []).push(`You: ${text}`);
      this.talk(cur.patient); // show your line while the reply is pending
      talkDown(sim3, text ?? '').then(({ cool, reply }) => {
        if (sim3.state !== 'angry') return; // they left / were resolved meanwhile
        sim3.calm = (sim3.calm ?? 0) + cool;
        const line = reply ?? (cool > 0.15 ? '...fine. FINE. I’ll wait.' : 'Oh NOW you’re a therapist?!');
        sim3.talkLog.push(`${sim3.displayName}: ${line}`);
        g.ui.bubbles.say(cur.patient, line.length > 90 ? line.slice(0, 88) + '…' : line,
          { cls: cool > 0.15 ? undefined : 'angry', hold: 3.5 });
        if (sim3.calm >= 1) {
          sim3.state = 'waiting';
          sim3.calm = 0;
          sim3.tArrive = g.clock.minutes; // patience reset
          cur.patient.setFace('normal');
          g.ui.toast(`${sim3.displayName} talked down. Nicely done.`, 'good');
          g.addScore(40, 'De-escalation');
          if (this.current?.type === 'talk') this.close();
        } else if (this.current?.type === 'talk' && this.current.patient === cur.patient) {
          this.talk(cur.patient);
        }
      });
      return;
    }
    const sim = cur.patient.sim;
    if (cur.type === 'imaging') {
      sim.imagingDone = true;
      sim.imagingRead = choice;
      const right = choice === sim.case.imaging.correct;
      g.ui.toast(right ? '✓ Read matches the radiologist.' : '✗ The radiologist disagrees with that read...', right ? 'good' : 'bad');
      g.addScore(right ? 60 : -40, right ? 'Correct interpretation' : 'Misread scan');
    }
    if (cur.type === 'dx') {
      if (text !== undefined && choice === undefined) {
        g.ui.toast('🤔 Considering that diagnosis...');
        judgeDx(sim, text).then(({ ok }) => {
          sim.dxPicked = ok ? (sim.case.correctDx ?? 0) : -1;
          if (ok) {
            g.ui.toast(`✓ Dx accepted: “${text}”`, 'good');
            g.addScore(100, 'Typed diagnosis');
            if (this.current?.type === 'dx') this.close();
          } else {
            g.ui.toast(`“${text}” doesn’t fit the picture (-20)`, 'bad');
            g.addScore(-20, 'Wrong dx attempt'); // board stays up — try again
          }
        });
        return;
      }
      sim.dxPicked = choice;
      const right = choice === sim.case.correctDx;
      if (right) { g.ui.toast(`✓ Dx: ${sim.case.dxOptions[choice]}`, 'good'); g.addScore(80, 'Correct diagnosis'); }
      else { g.ui.toast(`Hmm. “${sim.case.dxOptions[choice]}” locked in...`, 'bad'); g.addScore(-40, 'Wrong diagnosis'); }
    }
    this.close();
  }

  // abandon any half-finished "PRESS KEY…" capture — otherwise the window
  // listener leaks and silently rebinds (and persists!) the next keypress
  _cancelRebind() {
    if (this._grabKeyFn) {
      window.removeEventListener('keydown', this._grabKeyFn, { capture: true });
      this._grabKeyFn = null;
    }
    this._rebinding = false;
  }

  // 📖 first-run (and on-demand) how-to-play: the whole loop in one card, in
  // order, so a brand-new player can act without a 30-minute fumble
  howToPlay(fromPause = false) {
    const g = this.game;
    this.current = { type: 'howto', patient: null, options: [] };
    if (!fromPause) g.paused = true;
    const dt = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const move = dt ? 'WASD / arrows' : 'left-thumb stick';
    const grab = dt ? 'E' : 'the ✋ GRAB button';
    const act = dt ? 'F / Space' : 'the 📋 prompt at the bottom';
    const wheel = dt ? 'R' : 'the 📋 ORDERS button';
    this.box.innerHTML = `<h3>🏥 How to run the ED</h3>
      <div class="howto">
        <div class="hstep"><span>1</span><div><b>Meet them at the door.</b> Patients walk into the waiting room. ${dt ? 'Move with ' + move : 'Move with the ' + move}.</div></div>
        <div class="hstep"><span>2</span><div><b>Grab &amp; drag to a bed.</b> Walk up to a patient, ${grab} to grab, haul them into any open numbered room, let go on the bed.</div></div>
        <div class="hstep"><span>3</span><div><b>Work them up.</b> Stand at the bed and use ${act} to talk to them, draw labs, or open orders. Ask what's wrong — they answer like a real person.</div></div>
        <div class="hstep"><span>4</span><div><b>Order tests &amp; treatment.</b> Open the wheel with ${wheel}: call labs, imaging, surgery, or a consult. In the workup, the <b>💊 "Order ANYTHING"</b> bar treats — type "give fluids", "splint the ankle", anything.</div></div>
        <div class="hstep"><span>5</span><div><b>Diagnose, then discharge.</b> Once they're stable (green light over the door), pick 🏠 on the wheel or page the nurse to walk them out. Hit the day's quota before midnight.</div></div>
        <div class="hstep"><span>💡</span><div>Glowing floor rings mark the machines &amp; terminals. The green ⬤ terminal is <b>MED-DOC</b> — ask Claude for help. Tap 📟 to send your nurse on errands.</div></div>
      </div>
      <button class="close">${fromPause ? '◀ Back' : "LET'S GO"}</button>`;
    this._open();
    this.box.querySelector('.close').addEventListener('click', () => {
      try { localStorage.setItem('medteam.seenTutorial', '1'); } catch { /* private mode */ }
      if (fromPause) this.pauseMenu(); else this.close();
    });
  }

  // ⏸ the Escape menu: freeze the ED, offer a do-over, open settings
  pauseMenu() {
    this._cancelRebind();
    const g = this.game;
    this.current = { type: 'pause', patient: null, options: [] };
    g.paused = true;
    this.box.innerHTML = `<h3>⏸ PAUSED</h3>
      <p style="color:#6e7f9e;font-size:11px;margin:2px 0 10px">The whole ED is frozen. Nobody is dying right now. Enjoy it.</p>
      <button class="opt" id="p-resume">▶ RESUME (ESC)</button>
      <button class="opt" id="p-howto">📖 HOW TO PLAY</button>
      <button class="opt" id="p-restart">🔁 RESTART DAY ${g.clock.day}</button>
      <button class="opt" id="p-settings">⚙️ SETTINGS</button>`;
    this._open();
    this.box.querySelector('#p-resume').addEventListener('click', () => this.close());
    this.box.querySelector('#p-howto').addEventListener('click', () => this.howToPlay(true));
    this.box.querySelector('#p-restart').addEventListener('click', () => this.game.restartDay());
    this.box.querySelector('#p-settings').addEventListener('click', () => this.settingsPanel());
  }

  // ⚙️ audio, control feel, and fully rebindable keys
  settingsPanel() {
    this._cancelRebind();
    const g = this.game;
    this.current = { type: 'settings', patient: null, options: [] };
    g.paused = true;
    const K = settings.keys;
    const keyRow = (id, label) =>
      `<div class="setrow"><span>${label}</span><button class="opt mini keybtn" data-bind="${id}">${keyLabel(K[id])}</button></div>`;
    this.box.innerHTML = `<h3>⚙️ SETTINGS</h3>
      <div class="setrow"><span>🔊 Volume</span><input id="s-vol" type="range" min="0" max="100" value="${Math.round(settings.vol * 100)}"></div>
      <div class="setrow"><span>🔇 Sound</span><button class="opt mini" id="s-mute">${settings.muted ? 'MUTED' : 'ON'}</button></div>
      <div class="setrow"><span>📋 Orders wheel</span><button class="opt mini" id="s-wheel">${settings.wheelMode === 'hold' ? 'PRESS-AND-HOLD' : 'TOGGLE'}</button></div>
      <div class="setrow"><span>✋ Grab</span><button class="opt mini" id="s-grab">${settings.grabMode === 'hold' ? 'PRESS-AND-HOLD' : 'TOGGLE'}</button></div>
      <p style="color:#6e7f9e;font-size:11px;margin:10px 0 4px">KEYBINDS — click one, then press the new key. Movement is WASD / arrows.</p>
      ${keyRow('grab', '✋ Grab / release')}
      ${keyRow('action', '🩺 Context action')}
      ${keyRow('wheel', '📋 Orders wheel')}
      ${keyRow('swap', '🔄 Swap medic')}
      ${keyRow('tackle', '💥 Tackle')}
      ${keyRow('pager', '📟 Page the nurse')}
      <button class="opt" id="s-defaults">RESET TO DEFAULTS</button>
      <button class="close">◀ Back</button>`;
    this._open();
    this.box.querySelector('#s-vol').addEventListener('input', (e) => {
      settings.vol = (+e.target.value) / 100;
      saveSettings();
      g.audio.tap(); // hear the new level immediately
    });
    this.box.querySelector('#s-mute').addEventListener('click', (e) => {
      settings.muted = !settings.muted;
      e.target.textContent = settings.muted ? 'MUTED' : 'ON';
      saveSettings();
      if (!settings.muted) g.audio.tap();
    });
    this.box.querySelector('#s-wheel').addEventListener('click', (e) => {
      settings.wheelMode = settings.wheelMode === 'hold' ? 'toggle' : 'hold';
      e.target.textContent = settings.wheelMode === 'hold' ? 'PRESS-AND-HOLD' : 'TOGGLE';
      saveSettings();
    });
    this.box.querySelector('#s-grab').addEventListener('click', (e) => {
      settings.grabMode = settings.grabMode === 'hold' ? 'toggle' : 'hold';
      e.target.textContent = settings.grabMode === 'hold' ? 'PRESS-AND-HOLD' : 'TOGGLE';
      saveSettings();
    });
    this.box.querySelectorAll('.keybtn').forEach((b) => {
      b.addEventListener('click', () => {
        if (this._rebinding) return;
        this._rebinding = true;
        const old = b.textContent;
        b.textContent = 'PRESS KEY…';
        const grab = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._cancelRebind();
          if (e.key === 'Escape') { b.textContent = old; return; } // cancel
          settings.keys[b.dataset.bind] = e.code;
          saveSettings();
          b.textContent = keyLabel(e.code);
          g.ui.buttons.refreshHints();
        };
        this._grabKeyFn = grab;
        window.addEventListener('keydown', grab, { capture: true });
      });
    });
    this.box.querySelector('#s-defaults').addEventListener('click', () => {
      settings.keys = { ...DEFAULT_KEYS };
      settings.wheelMode = 'toggle';
      settings.grabMode = 'toggle';
      settings.vol = 1;
      settings.muted = false;
      saveSettings();
      g.ui.buttons.refreshHints();
      this.settingsPanel(); // repaint with fresh values
    });
    this.box.querySelector('.close').addEventListener('click', () => this.pauseMenu());
  }

  close() {
    if (this.current) this.game.audio?.close?.();
    clearTimeout(this._arcT);
    clearInterval(this._bootT);
    clearInterval(this._vfT);
    clearInterval(this._ttT);
    this._cancelRebind();
    this.current = null;
    this.veil.style.display = 'none';
    this.box.classList.remove('crtbox', 'blue', 'folders', 'errbox', 'adambox', 'adamadmin');
    this.game.paused = false; // only the pause/settings + Adam modals set it
  }
}
