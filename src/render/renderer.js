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

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141126);
    this.scene.fog = new THREE.FogExp2(0x141126, 0.0075);

    // rec-room camera: low third-person tilt (~35°), not a steep top-down
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    this.camOffset = new THREE.Vector3(0, 11, 15);
    this.camTarget = new THREE.Vector3();

    this.scene.add(new THREE.HemisphereLight(0xffe4c4, 0x2a2050, 1.0));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.6);
    key.position.set(6, 26, 12);
    key.castShadow = !lite;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 80;
    key.shadow.camera.left = -32; key.shadow.camera.right = 32;
    key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
    key.shadow.bias = -0.0006; key.shadow.radius = 3;
    this.scene.add(key, key.target);

    // one colored accent light per zone — the arcade glow, hospital edition
    for (const [color, x, z] of lite ? [] : [
      [0x6fd1ff, -5, 3],    // ED bays
      [0x36e0d6, -23, 7],   // lab
      [0xff5db0, 22, 7],    // pharmacy
      [0xffc24d, -21, -11], // ICU
      [0xb083ff, 7, -11],   // birthplace
      [0x8fb7ff, 21, -11],  // imaging
      [0xff8a5b, -5, 12],   // waiting room
    ]) {
      const p = new THREE.PointLight(color, 42, 16, 1.8);
      p.position.set(x, 3.2, z);
      this.scene.add(p);
    }

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
    this.camera.lookAt(this.camTarget.x, 1.2, this.camTarget.z);
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
