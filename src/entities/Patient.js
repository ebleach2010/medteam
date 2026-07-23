import { makePatientMesh, setFace } from '../render/meshes.js';
import { animateRig } from '../render/rig.js';
import { PatientSim } from '../sim/PatientSim.js';

const FIRST_NAMES = ['Sam', 'Riley', 'Jo', 'Max', 'Dee', 'Alex', 'Pat', 'Frankie', 'Lou', 'Bobbie',
  'Chris', 'Nat', 'Morgan', 'Casey', 'Jesse', 'Robin', 'Quinn', 'Dana', 'Sky', 'Marge'];

export function spawnPatient(game, caseData, x, z) {
  const body = game.physics.capsuleBody(x, z, { mass: 80, tiltWobble: false, linDamp: 1.2 });
  const mesh = makePatientMesh(game.rng);
  game.renderer.scene.add(mesh);
  const ent = {
    kind: 'patient', body, mesh,
    draggedBy: null, escortedBy: null,
    name: `${game.rng.pick(FIRST_NAMES)} ${String.fromCharCode(65 + game.rng.int(0, 25))}.`,
    face: 'normal',
    setFace(f) { if (this.face !== f) { this.face = f; setFace(this.mesh, f); } },
  };
  ent.sim = new PatientSim(game, ent, caseData);
  game.world.add(ent, 'patients');
  return ent;
}

export function syncPatientMesh(p, dt, now) {
  const pos = p.body.translation();
  const lying = p.sim.isLying();
  const sitting = !!p.sim.sitting && !lying;
  p.mesh.position.set(pos.x, lying ? pos.y - 0.45 : sitting ? pos.y - 0.62 : pos.y - 0.8, pos.z);
  const targetRotX = lying ? -Math.PI / 2 : 0;
  p.mesh.rotation.x += (targetRotX - p.mesh.rotation.x) * 0.25;
  p.mesh.rotation.y = p.sim.yaw;
  const v = p.body.linvel();
  const speed01 = Math.min(1, Math.hypot(v.x, v.z) / 3.4);
  animateRig(p.mesh, dt, now, (lying || sitting) ? 0 : speed01,
    { lying, sitting, dead: p.sim.state === 'dead' });
}
