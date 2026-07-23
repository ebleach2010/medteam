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

    // narrow, in-the-action chase view — you should always feel in a rush
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 160);
    this.camOffset = new THREE.Vector3(0, 4.9, 6.0); // tight third-person — a few rooms, not the whole hospital
    this.camTarget = new THREE.Vector3();

    // contrast recipe: dimmer ambient so the sun actually CARVES — shadows
    // and wall shading are what make the rooms read as 3D, not tan mush
    this.scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x8895aa, 1.0));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.3);
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
    // portrait: the landscape 40° vertical FOV would leave a hallway slit —
    // widen the lens and pull back so you still see a room and a half across
    if (this.camera.aspect < 1) {
      this.camera.fov = 70;
      this.camOffset.set(0, 7.2, 6.2); // steeper than landscape — less horizon, more floor
    } else {
      this.camera.fov = 40;
      this.camOffset.set(0, 4.9, 6.0);
    }
    this.camera.updateProjectionMatrix();
  }

  follow(pos, dt) {
    this.camTarget.lerp(pos, Math.min(1, dt * 7));
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 1.0, this.camTarget.z);
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
