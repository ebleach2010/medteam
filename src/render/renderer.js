import * as THREE from 'three';

export class Renderer {
  // lite mode (?lite=1): no AA / shadows / accent lights — for CI's software
  // GL and weak phones. Full mode is the rec-room treatment.
  constructor(canvas, lite = false) {
    this.lite = lite;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lite ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = !lite;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Human-Fall-Flat daylight: pale sky, bright soft ambient, one warm sun
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xaec6de);
    this.scene.fog = new THREE.FogExp2(0xaec6de, 0.005);

    // low, in-the-action chase view — HFF over-the-shoulder, walls around you
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 160);
    this.camOffset = new THREE.Vector3(0, 4.2, 5.6); // low enough to feel IN the corridors, high enough to see over cutaway walls
    this.camTarget = new THREE.Vector3();

    // contrast recipe: dimmer ambient so the sun actually CARVES — shadows
    // and wall shading are what make the rooms read as 3D, not tan mush
    const hemi = new THREE.HemisphereLight(0xf4f8ff, 0x8895aa, 1.0);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff2dc, 2.3);
    key.position.set(8, 28, 14);
    key.castShadow = !lite;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 90;
    key.shadow.camera.left = -32; key.shadow.camera.right = 32;
    key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
    key.shadow.bias = -0.0005; key.shadow.radius = 4;
    this.scene.add(key, key.target);
    this.hemi = hemi; this.key = key;
    // day/night endpoints — noon is the daylight recipe above, 12 AM is a dim,
    // cool ER lit mostly by its own fixtures & the call lights
    this._sky = { day: new THREE.Color(0xaec6de), night: new THREE.Color(0x0a1626) };
    this._hemiSky = { day: new THREE.Color(0xf4f8ff), night: new THREE.Color(0x27384f) };
    this._hemiGnd = { day: new THREE.Color(0x8895aa), night: new THREE.Color(0x131b28) };
    this._keyCol = { day: new THREE.Color(0xfff2dc), night: new THREE.Color(0x5f77b0) };

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // portrait: the landscape 40° vertical FOV would leave a hallway slit —
    // widen the lens and pull back so you still see a room and a half across
    if (this.camera.aspect < 1) {
      this.camera.fov = 72;
      this.camOffset.set(0, 6.9, 6.0); // steeper than landscape — less horizon, more floor
    } else {
      this.camera.fov = 46;
      this.camOffset.set(0, 4.2, 5.6);
    }
    this.camera.updateProjectionMatrix();
  }

  follow(pos, dt) {
    this.camTarget.lerp(pos, Math.min(1, dt * 7));
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 1.0, this.camTarget.z);
  }

  // Drift the lighting across the 24-hour shift. `minutes` is 0…1440 (0 = 12 AM).
  // Midnight is a dim, blue-lit ward; midday is the bright daylight recipe.
  setTimeOfDay(minutes) {
    const t = ((minutes % 1440) + 1440) % 1440 / 1440;         // 0..1 over the day
    let day = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);           // 0 at 12 AM → 1 at 12 PM
    day = Math.pow(day, 1.35);                                 // linger in the dark hours
    this._day = day;
    const L = (a, b) => a + (b - a) * day;
    // lite mode has no sconces/call-light point lights to carry the night, so
    // keep its ambient floor much higher or the ward goes pitch black
    this.hemi.intensity = L(this.lite ? 0.5 : 0.16, 1.0);
    this.key.intensity = L(this.lite ? 0.85 : 0.22, 2.3);
    this.renderer.toneMappingExposure = L(this.lite ? 0.95 : 0.74, 1.15);
    this.hemi.color.copy(this._hemiSky.night).lerp(this._hemiSky.day, day);
    this.hemi.groundColor.copy(this._hemiGnd.night).lerp(this._hemiGnd.day, day);
    this.key.color.copy(this._keyCol.night).lerp(this._keyCol.day, day);
    const sky = _skyC.copy(this._sky.night).lerp(this._sky.day, day);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
  }

  // 0 (midnight) … 1 (noon) — how much daylight is in the scene right now, so
  // fixtures/call-lights can burn brighter after dark
  get daylight() { return this._day ?? 1; }

  render() { this.renderer.render(this.scene, this.camera); }

  // world position → CSS pixels (for bubbles/monitors). Returns null if behind camera.
  project(v3, out = { x: 0, y: 0 }) {
    const v = _pv.copy(v3).project(this.camera);
    if (v.z > 1) return null;
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    return out;
  }
}
const _pv = new THREE.Vector3();
const _skyC = new THREE.Color();
