// Entity registry. Every entity: { id, kind, mesh?, body?, update?(dt) }.
export class World {
  constructor() { this.entities = new Map(); this.tags = new Map(); this._nextId = 1; }
  add(entity, ...tags) {
    entity.id = this._nextId++;
    entity.tags = tags;
    this.entities.set(entity.id, entity);
    for (const t of tags) (this.tags.get(t) ?? this.tags.set(t, new Set()).get(t)).add(entity);
    return entity;
  }
  remove(entity, game) {
    if (!this.entities.has(entity.id)) return;
    this.entities.delete(entity.id);
    for (const t of entity.tags ?? []) this.tags.get(t)?.delete(entity);
    if (entity.mesh) entity.mesh.parent?.remove(entity.mesh);
    if (entity.body && game) game.physics.world.removeRigidBody(entity.body);
  }
  byTag(tag) { return this.tags.get(tag) ?? new Set(); }
}
