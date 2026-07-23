// window.__game — Playwright drives the game through the same intent pipe the
// touch UI uses, which keeps the future co-op seam continuously exercised.
import { caseById } from '../data/cases.js';
import { spawnPatient } from '../entities/Patient.js';

export function installTestApi(game) {
  window.__game = {
    game,
    ready: true,
    start() { game.ui.screens.hide(); game.startDay(1); },
    inject(intent) { game.enqueue(intent); },
    state() {
      const chars = [game.nurse, game.doctor].map((c) => ({
        role: c.role, pos: c.pos, carrying: c.carrying?.label ?? null,
        dragging: c.dragging?.sim.displayName ?? null,
      }));
      return {
        mode: game.mode, day: game.clock.day, minutes: game.clock.minutes,
        score: game.score, stats: { ...game.dayStats },
        active: game.active.role, chars,
        patients: [...game.world.byTag('patients')].map((p) => ({
          id: p.id, name: p.sim.displayName, case: p.sim.case.id, state: p.sim.state,
          critical: p.sim.critical, hooked: p.sim.hooked, lab: p.sim.labState,
          imagingDone: p.sim.imagingDone, dx: p.sim.dxPicked, treated: p.sim.treated,
          bed: p.sim.bed?.index ?? null, pos: p.body.translation(),
        })),
        items: [...game.world.byTag('items')].map((i) => ({
          kind: i.itemKind, label: i.label, held: !!i.heldBy, pos: i.body.translation(),
        })).slice(0, 60),
        modal: game.ui.modals.current?.type ?? null,
        centrifuge: { busy: !!game.map.centrifuge.busy, timer: game.map.centrifuge.timer },
      };
    },
    spawnCase(id, x, z) {
      const c = caseById(id);
      if (!c) throw new Error('no case ' + id);
      const cc = { ...c, timeline: c.timeline.map((k) => ({ ...k })) };
      return spawnPatient(game, cc, x ?? game.map.entrance.x, z ?? game.map.entrance.z).id;
    },
    teleport(role, x, z) {
      const ch = role === 'nurse' ? game.nurse : game.doctor;
      const y = game.map.floorYAt(x, z) + 1.0;
      ch.body.setTranslation({ x, y, z }, true);
      ch.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      if (ch.carrying) { // a carried item rides along (walking would have brought it)
        ch.carrying.body.setTranslation({ x, y: y + 0.1, z: z + 0.4 }, true);
        ch.carrying.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    },
    teleportPatient(id, x, z) {
      const p = [...game.world.byTag('patients')].find((q) => q.id === id);
      if (p) {
        game.setPatientDynamic(p);
        p.body.setTranslation({ x, y: game.map.floorYAt(x, z) + 1.0, z }, true);
      }
    },
    skipMinutes(m) { game.clock.minutes += m; },
    setTimeScale(s) { game.clock.timeScale = s; },
    centrifugeFastForward() { if (game.map.centrifuge.busy) game.map.centrifuge.timer = 0.05; },
  };
}
