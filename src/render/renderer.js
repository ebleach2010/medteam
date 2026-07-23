import * as THREE from 'three';

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11182a);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    this.camOffset = new THREE.Vector3(0, 20, 9.5);
    this.camTarget = new THREE.Vector3();

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a3350, 1.15);
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(-14, 30, 10);
    this.scene.add(hemi, dir);

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
    this.camTarget.lerp(pos, Math.min(1, dt * 8));
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z);
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
