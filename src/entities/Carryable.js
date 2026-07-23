import { makeItemMesh } from '../render/meshes.js';

// Small physics items: blood vials, lab result papers, med boxes, and the
// lobby props angry patients love to launch (pass data.size for those).
export function spawnCarryable(game, kind, x, y, z, data = {}) {
  const body = game.physics.itemBody(x, y, z, data.size ?? {});
  const mesh = makeItemMesh(kind, data.color, data.size);
  game.renderer.scene.add(mesh);
  const ent = {
    kind: 'item', itemKind: kind, body, mesh, data,
    label: data.label ?? kind,
    heldBy: null,
  };
  game.world.add(ent, 'items');
  return ent;
}
