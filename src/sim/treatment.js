import { medById } from '../data/meds.js';
import { satisfies, regimenComplete } from '../data/equiv.js';

// Applying a med to a patient — where heroes are made and malpractice happens.
// A few seconds after any therapy, the staff radios back whether the room
// responded — so you always KNOW whether your order did anything.
function radioReport(game, sim, med, responded, rec, tone) {
  const where = sim.bed ? `ROOM ${sim.bed.roomNo}` : sim.displayName.toUpperCase();
  setTimeoutTicks(game, 3.5, () => {
    if (sim.state === 'dead') { game.ui.announce(`📻 ${where} LOST DESPITE ${med.name.toUpperCase()} — SORRY, SIR.`, 'bad'); return; }
    game.ui.announce(`📻 ${where} ${responded ? 'RESPONDED' : 'DID NOT RESPOND'} TO ${med.name.toUpperCase()} — ${rec}, SIR!`, tone);
    game.audio?.blip?.();
  });
}

export function giveMed(game, patient, medId) {
  const sim = patient.sim;
  const med = medById(medId);
  const name = sim.displayName;

  // sedatives are universal (and the answer to agitation)
  if (medId === 'sedative') {
    if (['agitated', 'pinned'].includes(sim.state)) { sim.sedate(); game.addScore(40, 'Chemical calm'); }
    else { sim.sedate(); game.ui.toast(`${name} didn’t need sedation... they’re napping now.`); }
    return;
  }

  // contraindications — the case's designated landmines
  const contra = (sim.case.contra ?? []).find((c) => c.med === medId);
  if (contra) {
    if (contra.effect === 'death') {
      game.ui.toast(`☠ ${contra.note}`, 'bad');
      sim._sayRaw('...that feels... very wrong...', 'critical');
      sim.accel = 10;
      sim.critical = true;
      setTimeoutTicks(game, 4, () => sim.die('iatrogenic — ' + med.name, true));
      game.addScore(-200, 'Fatal medication error');
      return;
    }
    if (contra.effect === 'accelerate') {
      game.ui.toast(`⚠ ${contra.note}`, 'bad');
      sim.accel *= 3;
      sim._say('worse', 'critical');
      game.addScore(-80, 'Harmful medication');
      radioReport(game, sim, med, false, 'PATIENT WORSE — RECOMMEND IMMEDIATE RE-EVALUATION', 'bad');
      return;
    }
    game.ui.toast(`⚠ ${contra.note}`, 'bad');
    game.addScore(-30, 'Wrong med');
    radioReport(game, sim, med, false, 'ADVERSE REACTION NOTED — RECOMMEND DIFFERENT AGENT', 'bad');
    return;
  }

  // tPA without a head CT: gambling with a brain
  if (medId === 'tpa' && sim.case.tpaNeedsCT && !sim.imagingDone) {
    if (game.rng.chance(0.5)) {
      game.ui.toast('☠ tPA without a CT — they were bleeding. Catastrophe.', 'bad');
      sim.accel = 10; sim.critical = true;
      setTimeoutTicks(game, 4, () => sim.die('tPA-induced hemorrhage (no CT first)', true));
      game.addScore(-200, 'tPA before imaging');
      return;
    }
    game.ui.toast('😅 tPA before the CT... you got lucky. THIS time.', 'bad');
  }

  // meds that demand labs first (e.g., insulin before knowing the K+)
  if ((sim.case.labsRequiredForMeds ?? []).includes(medId) && sim.labState !== 'read') {
    if (game.rng.chance(0.5)) {
      game.ui.toast(`☠ ${med.name} blind, no labs — it went badly.`, 'bad');
      sim.accel = 10; sim.critical = true;
      setTimeoutTicks(game, 4, () => sim.die(`${med.name} given without labs`, true));
      game.addScore(-150, 'Meds without labs');
      return;
    }
    game.ui.toast('😬 Dosing blind without labs... it held. Barely.', 'bad');
  }

  const needed = sim.case.treatment.meds;
  sim.medsGiven.add(medId);
  // clinical equivalence: a defensible substitute counts (IV fluids for a
  // dehydrated patient, any sensible antibiotic for a simple infection...).
  // Specific antidotes still demand the exact agent — see data/equiv.js.
  if (needed.some((m) => satisfies(m, medId))) {
    game.ui.toast(`✓ ${med.name} given to ${name}`, 'good');
    game.addScore(30, 'Correct med');
    const complete = regimenComplete(needed, sim.medsGiven);
    if (complete) applyTreatment(game, sim);
    radioReport(game, sim, med, true,
      complete
        ? (sim.dxPicked == null ? 'READY FOR DISPO ONCE STABLE — DIAGNOSE FOR FULL CREDIT' : 'READY FOR DISPO ONCE STABLE')
        : 'PARTIAL RESPONSE — CONTINUE CURRENT PLAN', 'good');
  } else {
    game.ui.toast(`${med.name} given... it does nothing useful.`);
    game.addScore(-10, 'Unnecessary med');
    radioReport(game, sim, med, false, 'RECOMMEND FURTHER WORKUP', 'bad');
  }
}

export function applyTreatment(game, sim) {
  if (sim.treated) return;
  sim.treated = true;
  sim.tTreated = game.clock.minutes;
  sim.critical = false;
  sim.ent.setFace('normal');
  sim._say('better');
  game.ui.toast(`${sim.displayName} is responding to treatment!`, 'good');
  if (sim.case.agitateOnTreat) {
    // naloxone special: awake, alive, FURIOUS
    setTimeoutTicks(game, 2, () => sim.agitate());
  }
}

// schedule a callback n fixed-seconds out on the game's own timer (pausable)
function setTimeoutTicks(game, seconds, fn) {
  game.timers.push({ at: game.timeReal + seconds, fn });
}
