export function makeBus() {
  const map = new Map();
  return {
    on(type, fn) { (map.get(type) ?? map.set(type, []).get(type)).push(fn); return () => this.off(type, fn); },
    off(type, fn) { const l = map.get(type); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(type, payload) { const l = map.get(type); if (l) for (const fn of [...l]) fn(payload); },
  };
}
