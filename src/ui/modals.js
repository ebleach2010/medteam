import { generateScan } from '../render/xray.js';
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
      <button class="opt" data-w="ekg">🫀 Run EKG ${w.ekg ? '✓' : ''}</button>
      <button class="opt" data-w="phys">🩺 Physical exam ${w.phys ? '✓' : ''}</button>
      <button class="opt" data-w="neuro">🧠 Neuro exam ${w.neuro ? '✓' : ''}</button>
      <button class="opt" data-w="dx">✅ Diagnose</button>
      <button class="close">Close</button>`;
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'workup', choice: b.dataset.w } })));
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
        Complaint: “${c.complaint[0]}” ${hints.length ? `· ${hints.join(' · ')}` : '· no workup yet 😬'}</p>`;
    for (const i of order) body += `<button class="opt" data-i="${i}">${c.dxOptions[i]}</button>`;
    body += '<button class="close">Close</button>';
    this.box.innerHTML = body;
    this.veil.style.display = 'flex';
    this.box.querySelectorAll('.opt').forEach((b) =>
      b.addEventListener('pointerdown', () =>
        this.game.enqueue({ type: 'SELECT', actorId: this.game.active.id, payload: { modal: 'dx', choice: +b.dataset.i } })));
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
  resolve(choice, actor) {
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
      if (!sim2.workups[choice]) {
        sim2.workups[choice] = true;
        g.addScore(10, 'Workup');
        g.audio.tap();
      }
      this.workup(cur.patient); // re-render with the new finding
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
      sim.dxPicked = choice;
      const right = choice === sim.case.correctDx;
      if (right) { g.ui.toast(`✓ Dx: ${sim.case.dxOptions[choice]}`, 'good'); g.addScore(80, 'Correct diagnosis'); }
      else { g.ui.toast(`Hmm. “${sim.case.dxOptions[choice]}” locked in...`, 'bad'); g.addScore(-40, 'Wrong diagnosis'); }
    }
    this.close();
  }

  close() { this.current = null; this.veil.style.display = 'none'; }
}
