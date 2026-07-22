import { makeItemMesh } from '../render/meshes.js';

// Small physics items: blood vials, lab result papers, med boxes.
export function spawnCarryable(game, kind, x, y, z, data = {}) {
  const body = game.physics.itemBody(x, y, z);
  const mesh = makeItemMesh(kind, data.color);
  game.renderer.scene.add(mesh);
  const ent = {
    kind: 'item', itemKind: kind, body, mesh, data,
    label: data.label ?? kind,
    heldBy: null,
  };
  game.world.add(ent, 'items');
  return ent;
}
