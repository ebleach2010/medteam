import { generateScan } from '../render/xray.js';
import { answerQuestion, deescalate, matchTreatment, judgeDiagnosis } from '../sim/talk.js';
import { MEDS, SHELVES } from '../data/meds.js';

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

  labResults(patient) {
    const c = patient.sim.case;
    const rows = Object.entries(c.labs ?? {})
      .map(([k, v]) => `${k.padEnd(14)} ${/[A-Z]{3}/.test(v) ? `<b>${v}</b>` : v}`)
      .join('\n');
    this._show({
      type: 'labs', patient, options: [],
      html: `<h3>🧪 Lab results — ${patient.sim.displayName}</h3>
             <div class="paper">MEDTEAM GENERAL LABORATORY\n------------------------\n${rows || 'No labs on file.'}</div>`,
      closable: true,
    });
    patient.sim.labState = 'read';
    this.game.addScore(20, 'Labs reviewed');
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
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
  }

  // pick an imaging modality for the porter to run
  modalityPick(patient) {
    this.current = { type: 'modality', patient, options: [] };
    let body = `<h3>📷 Order imaging — ${patient.sim.displayName}</h3>`;
    for (const m of this.game.constructor.MODALITIES) {
      body += `<button class="opt" data-m="${m.id}">${m.label}</button>`;
    }
    body += '<button class="close">Cancel</button>';
    this.box.innerHTML = body;
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'modality', choice: b.dataset.m } })));
    this.box.querySelector('.close').addEventListener('pointerdown', () => this.close());
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
    this.box.querySelector('[data-t]').addEventListener('pointerdown', () => {
      const text = this.box.querySelector('#talkbar')?.value ?? '';
      if (!text.trim()) return;
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'talk', text } });
    });
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
    this.box.querySelector('#dxgo')?.addEventListener('pointerdown', () => {
      const text = this.box.querySelector('#dxbar')?.value ?? '';
      if (!text.trim()) return;
      this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'dx', text } });
    });
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
        const a = answerQuestion(sim2, text ?? '');
        (sim2.chatLog ??= []).push({ q: text, a });
        g.ui.bubbles.say(cur.patient, a.length > 90 ? a.slice(0, 88) + '…' : a, { hold: 4.5 });
        this.workup(cur.patient);
        return;
      }
      if (choice === 'treat') {
        const medId = matchTreatment(text ?? '');
        if (medId) g.orderMedFetch(cur.patient, medId);
        else g.ui.toast('Pharmacy: “we don’t recognize that order.”', 'bad');
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
    if (cur.type === 'modality') {
      g.orderImaging(cur.patient, choice);
      this.close();
      return;
    }
    if (cur.type === 'talk') {
      const sim3 = cur.patient.sim;
      const cool = deescalate(sim3, text ?? '');
      sim3.calm = (sim3.calm ?? 0) + cool;
      if (cool > 0.15) g.ui.bubbles.say(cur.patient, '...fine. FINE. I’ll wait.', { hold: 3.5 });
      else g.ui.bubbles.say(cur.patient, 'Oh NOW you’re a therapist?!', { cls: 'angry', hold: 3.5 });
      if (sim3.calm >= 1) {
        sim3.state = 'waiting';
        sim3.calm = 0;
        sim3.tArrive = g.clock.minutes; // patience reset
        cur.patient.setFace('normal');
        g.ui.toast(`${sim3.displayName} talked down. Nicely done.`, 'good');
        g.addScore(40, 'De-escalation');
        this.close();
      } else {
        this.talk(cur.patient);
      }
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
        const ok = judgeDiagnosis(sim, text);
        sim.dxPicked = ok ? 0 : -1;
        if (ok) { g.ui.toast(`✓ Dx accepted: “${text}”`, 'good'); g.addScore(100, 'Typed diagnosis'); }
        else { g.ui.toast(`“${text}” doesn’t fit the picture (-20)`, 'bad'); g.addScore(-20, 'Wrong dx attempt'); return; }
        this.close();
        return;
      }
      sim.dxPicked = choice;
      const right = choice === sim.case.correctDx;
      if (right) { g.ui.toast(`✓ Dx: ${sim.case.dxOptions[choice]}`, 'good'); g.addScore(80, 'Correct diagnosis'); }
      else { g.ui.toast(`Hmm. “${sim.case.dxOptions[choice]}” locked in...`, 'bad'); g.addScore(-40, 'Wrong diagnosis'); }
    }
    this.close();
  }

  close() { this.current = null; this.veil.style.display = 'none'; }
}
