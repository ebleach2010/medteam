import { generateScan } from '../render/xray.js';
import { askPatient, talkDown, orderTreatment, judgeDx, medDocConsult, llmEnabled, getKey, setKey, getModel, setModel, MODELS } from '../sim/llm.js';
import { MEDS, SHELVES } from '../data/meds.js';
import { PANELS, filterLabs } from '../data/labs.js';
import { spawnCarryable } from '../entities/Carryable.js';
import { ekgPath } from './monitor.js';

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

  // results show ONLY the panels that were ordered — a test never sent never
  // comes back. The printout says what you skipped.
  labResults(patient) {
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
    this._show({
      type: 'labs', patient, options: [],
      html: `<h3>🧪 Lab results — ${sim.displayName}</h3>
             <div class="paper">MEDTEAM GENERAL LABORATORY\n------------------------\n${c.labs === null ? 'No labs indicated for this presentation.' : lines.join('\n')}</div>`,
      closable: true,
    });
    sim.labState = 'read';
    this.game.addScore(20, 'Labs reviewed');
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
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.ptoggle').forEach((b) =>
      b.addEventListener('pointerdown', () => {
        b.classList.toggle('on');
        b.querySelector('.tick').textContent = b.classList.contains('on') ? '☑' : '☐';
      }));
    this.box.querySelector('#sendlabs').addEventListener('pointerdown', () => {
      const panels = [...this.box.querySelectorAll('.ptoggle.on')].map((b) => b.dataset.p);
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'labs_order', choice: panels } });
    });
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
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
      this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
    };
    render();
    this.veil.style.display = 'flex';
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
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('pointerdown', () => this.cabinet(b.dataset.tab)));
    this.box.querySelectorAll('.medbtn').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'cabinet', choice: b.dataset.med } })));
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
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
      <div class="txrow"><input id="treatbar" placeholder="Order treatment (e.g. wrap ankle, give epi)..." /><button class="opt go-mini" data-w="treat">💊</button></div>
      ${(sim.chatLog ?? []).slice(-2).map((e) => `<div class="chatline"><b>You:</b> ${e.q}<br><b>${sim.displayName}:</b> ${e.a}</div>`).join('')}
      <button class="opt" data-w="ekg">🫀 Run EKG ${w.ekg ? '✓' : ''}</button>
      <button class="opt" data-w="phys">🩺 Physical exam ${w.phys ? '✓' : ''}</button>
      <button class="opt" data-w="neuro">🧠 Neuro exam ${w.neuro ? '✓' : ''}</button>
      <button class="opt" data-w="dx">✅ Diagnose</button>
      <button class="close">Close</button>`;
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt').forEach((b) =>
      b.addEventListener('pointerdown', (ev) => {
        const w2 = b.dataset.w;
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
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
  }

  // the tech's board: every study on the menu, or type what you want and
  // confirm with the ✅ — typing NEVER closes or submits this by accident
  studyPick(task) {
    this.current = { type: 'study', patient: task.patient, options: [], task };
    let body = `<h3>📷 Order a study — ${task.patient.sim.displayName}</h3>
      <div class="txrow"><input id="studybar" placeholder="Type a study (e.g. CT with contrast)..." /><button class="opt go-mini" id="studygo">✅</button></div>
      <p style="color:#8a7a55;font-size:11px;margin:2px 0 6px">...or tap one from the board:</p>`;
    for (const m of this.game.constructor.MODALITIES) {
      body += `<button class="opt" data-m="${m.id}">${m.label} <span style="float:right;color:#8a7a55">${m.t}s</span></button>`;
    }
    body += '<button class="close">Not yet</button>';
    this.box.innerHTML = body;
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt[data-m]').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'study', choice: b.dataset.m } })));
    this._wireTyped('#studybar', '#studygo', (text) =>
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'study', text } }));
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
  }

  // the surgeon's board — same deal, sharper consequences
  surgeryPick(task) {
    this.current = { type: 'surgery', patient: task.patient, options: [], task };
    let body = `<h3>🔪 Choose the operation — ${task.patient.sim.displayName}</h3>
      <div class="txrow"><input id="surgbar" placeholder="Type an operation..." /><button class="opt go-mini" id="surggo">✅</button></div>
      <p style="color:#8a7a55;font-size:11px;margin:2px 0 6px">...or tap one from the board:</p>`;
    for (const s of this.game.constructor.SURGERIES) {
      body += `<button class="opt" data-s="${s.id}">${s.label} <span style="float:right;color:#8a7a55">${s.t}s</span></button>`;
    }
    body += '<button class="close">Not yet</button>';
    this.box.innerHTML = body;
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt[data-s]').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'surgery', choice: b.dataset.s } })));
    this._wireTyped('#surgbar', '#surggo', (text) =>
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'surgery', text } }));
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
  }

  // text bars submit ONLY via their ✅ button (or a deliberate Enter);
  // keystrokes are fenced off from the game's hotkeys
  _wireTyped(inputSel, btnSel, submit) {
    const input = this.box.querySelector(inputSel);
    const go = () => { const t = input?.value ?? ''; if (t.trim()) submit(t); };
    if (btnSel) this.box.querySelector(btnSel)?.addEventListener('pointerdown', go);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
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
    this.veil.style.display = 'flex';
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
  }

  // typed de-escalation for the angry
  talk(patient) {
    const sim = patient.sim;
    this.current = { type: 'talk', patient, options: [] };
    this.box.innerHTML = `<h3>😡 ${sim.displayName} is furious</h3>
      <div class="paper">${(sim.talkLog ?? ['"' + (sim.lastCurse ?? 'THIS PLACE IS A JOKE!') + '"']).slice(-3).join('\n')}</div>
      <div class="txrow"><input id="talkbar" placeholder="Say something calming..." /><button class="opt go-mini" data-t="1">💬</button></div>
      <button class="close">Walk away</button>`;
    this.veil.style.display = 'flex';
    this._wireTyped('#talkbar', '[data-t]', (text) =>
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'talk', text } }));
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
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
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt[data-i]').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'dx', choice: +b.dataset.i } })));
    this._wireTyped('#dxbar', '#dxgo', (text) =>
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'dx', text } }));
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
  }

  _show({ type, patient, options, html, closable }) {
    this.current = { type, patient, options };
    let body = html;
    options.forEach((o, i) => { body += `<button class="opt" data-i="${i}">${o}</button>`; });
    if (closable) body += '<button class="close">Close</button>';
    this.box.innerHTML = body;
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: type, choice: +b.dataset.i } })));
    this.box.querySelector('.close')?.addEventListener('pointerdown', () => this.close());
  }

  // 🖥 MED-DOC 4000 — the green-phosphor consult terminal at the station.
  // Live Claude with the active charts when a key is connected; an offline
  // symptom index otherwise. KEY <key> stores the API key right here.
  medDoc() {
    const g = this.game;
    g.medDocLog ??= [{
      who: 'doc',
      text: `MED-DOC 4000 — CLINICAL CONSULT SYSTEM
(C) 1987 MEDTEAM GENERAL. ALL RIGHTS RESERVED.
${llmEnabled() ? `LINK: ● LIVE — ${getModel()}` : 'LINK: ○ OFFLINE — TYPE: KEY <ANTHROPIC-API-KEY>'}
REF DB: 500 ED PATHWAYS LOADED.
TYPE A QUESTION · "LOOKUP <DX>" · "CENSUS" · "CLEAR"`,
    }];
    this.current = { type: 'meddoc', patient: null, options: [] };
    this.box.classList.add('crtbox');
    this.box.innerHTML = `<h3>▓ MED-DOC 4000</h3>
      <div class="crt-log" id="crtlog"></div>
      <div class="txrow"><span class="crt-ps">C:\\&gt;</span><input id="crtbar" autocomplete="off" spellcheck="false" placeholder="query..." /><button class="opt go-mini crt-go" id="crtgo">⏎</button></div>
      <button class="close">POWER OFF</button>`;
    this.veil.style.display = 'flex';
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
      if (/^clear$/i.test(t)) { g.medDocLog = null; this.medDoc(); return; }
      if (/^key\s+\S/i.test(t)) {
        setKey(t.replace(/^key\s+/i, '').trim());
        g.medDocLog.push({ who: 'doc', text: llmEnabled() ? `KEY STORED. LINK: ● LIVE — ${getModel()}` : 'KEY CLEARED. LINK: ○ OFFLINE' });
        paint();
        return;
      }
      g.medDocLog.push({ who: 'you', text: t });
      const pending = { who: 'doc', text: '▮ PROCESSING...' };
      g.medDocLog.push(pending);
      paint();
      const reply = await medDocConsult(g, t);
      pending.text = reply;
      if (this.current?.type === 'meddoc') paint();
    });
    setTimeout(() => input?.focus(), 50);
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
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
    this.veil.style.display = 'flex';
    this._wireTyped('#keybar', '#keygo', (key) => {
      setKey(key.trim());
      this.game.ui.toast(key.trim() ? '🔑 Claude connected' : 'Key cleared', 'good');
      this.apiSettings();
    });
    this.box.querySelectorAll('[data-model]').forEach((b) =>
      b.addEventListener('pointerdown', () => { setModel(b.dataset.model); this.apiSettings(); }));
    this.box.querySelector('#keyoff')?.addEventListener('pointerdown', () => {
      setKey('');
      this.game.ui.toast('Key forgotten');
      this.apiSettings();
    });
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
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
        g.ui.toast('💊 Pharmacy processing the order...');
        orderTreatment(sim2, text ?? '').then(({ medId }) => {
          if (medId) g.orderMedFetch(cur.patient, medId);
          else g.ui.toast('Pharmacy: “we don’t recognize that order.”', 'bad');
        });
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
        // bedside draw: the vial goes straight into the actor's sticky hand
        const who = actor ?? g.active;
        sim.labState = 'drawn';
        const a = who.handAnchor();
        const vial = spawnCarryable(g, 'vial', a.x, 0.8, a.z,
          { patientId: cur.patient.id, label: `Blood: ${sim.displayName}` });
        who.carrying = vial; vial.heldBy = who;
        who.grabHeld = true;
        if (sim.orders?.has('labs')) g.addScore(10, 'Ordered labs drawn');
        g.ui.toast(`Blood drawn (${panels.length} panels) — to the centrifuge!`);
      }
      this.close();
      return;
    }
    if (cur.type === 'study' || cur.type === 'surgery') {
      const list = cur.type === 'study' ? g.constructor.MODALITIES : g.constructor.SURGERIES;
      const picked = choice !== undefined
        ? list.find((m) => m.id === choice)
        : pickByText(list, text);
      if (!picked) {
        g.ui.toast(cur.type === 'study'
          ? 'Tech: “never heard of that study.”' : 'Surgeon: “that is not an operation.”', 'bad');
        return; // board stays up — fix the typo and hit ✅ again
      }
      const t2 = cur.task;
      if (t2?.phase === 'awaitChoice') {
        if (cur.type === 'study') g.beginScan(t2, picked);
        else g.beginSurgery(t2, picked);
      }
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
          sim.dxPicked = ok ? 0 : -1;
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

  close() { clearInterval(this._vfT); this.current = null; this.veil.style.display = 'none'; this.box.classList.remove('crtbox'); }
}
