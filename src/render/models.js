import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Real low-poly CC0 props (poly.pizza: Kenney / Quaternius / CreativeTrio,
// all Public Domain). Loaded once at boot; every prop clones a prepared
// template. If a model 404s (packed single-file build) or the loader is
// skipped (?lite / CI software GL), useModel() returns null and the caller
// falls back to its procedural mesh — so the game always builds.
const TEMPLATES = new Map();   // key -> loaded gltf.scene (raw)
let LOADED = false;

const FILES = {
  bed: 'models/bed.glb',
  chair: 'models/chair.glb',
  officechair: 'models/officechair.glb',
  counter: 'models/counter.glb',
  monitor: 'models/monitor.glb',
  firstaid: 'models/firstaid.glb',
  sign: 'models/sign.glb',
};

export async function preloadModels(lite = false) {
  if (lite) return; // CI / weak GL: skip straight to procedural
  const loader = new GLTFLoader();
  const one = (key, url) => new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const t = setTimeout(done, 7000); // never hang boot on a slow/missing asset
    loader.load(url,
      (gltf) => { TEMPLATES.set(key, gltf.scene); clearTimeout(t); done(); },
      undefined,
      () => { clearTimeout(t); done(); }); // missing asset → silent fallback
  });
  await Promise.all(Object.entries(FILES).map(([k, u]) => one(k, u)));
  LOADED = true;
}

export const modelsReady = () => LOADED && TEMPLATES.size > 0;

const _box = new THREE.Box3();
const _dim = new THREE.Vector3();
const _ctr = new THREE.Vector3();

// clone a template, normalized: footprint centered at origin, base at y=0,
// longest horizontal edge scaled to `size`, then rotated ry about y.
// opts: { size, ry, yoff, tint } — tint recolors every mesh (optional).
export function useModel(key, { size = 1, ry = 0, yoff = 0, tint = null } = {}) {
  const tpl = TEMPLATES.get(key);
  if (!tpl) return null;
  const inner = tpl.clone(true);
  _box.setFromObject(inner);
  _box.getSize(_dim);
  _box.getCenter(_ctr);
  const horiz = Math.max(_dim.x, _dim.z) || 1;
  const s = size / horiz;
  inner.scale.setScalar(s);
  inner.position.set(-_ctr.x * s, -_box.min.y * s + yoff, -_ctr.z * s);
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (tint != null) {
      o.material = o.material.clone();
      o.material.color = new THREE.Color(tint);
    }
  });
  const outer = new THREE.Group();
  outer.add(inner);
  outer.rotation.y = ry;
  outer.userData.isModel = true;
  return outer;
}
