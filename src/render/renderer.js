import * as THREE from 'three';

export class Renderer {
  // lite mode (?lite=1): no AA / shadows / accent lights — for CI's software
  // GL and weak phones. Full mode is the rec-room treatment.
  constructor(canvas, lite = false) {
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

    // close chase-ish tilt — the blob should be BIG on screen
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 160);
    this.camOffset = new THREE.Vector3(0, 7.5, 10);
    this.camTarget = new THREE.Vector3();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb2bccc, 1.35));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.9);
    key.position.set(8, 28, 14);
    key.castShadow = !lite;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 90;
    key.shadow.camera.left = -32; key.shadow.camera.right = 32;
    key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
    key.shadow.bias = -0.0005; key.shadow.radius = 4;
    this.scene.add(key, key.target);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  follow(pos, dt) {
    this.camTarget.lerp(pos, Math.min(1, dt * 7));
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget.x, 1.0, this.camTarget.z);
  }

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
