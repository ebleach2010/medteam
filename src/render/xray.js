// Procedural "radiology": stylized X-ray / CT images drawn on canvas, seeded
// per patient so a re-scan looks identical. Returns a data URL for <img>.
import { makeRng } from '../core/rng.js';

export function generateScan(type, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = 'lighter';

  const soft = (x, y, r, alpha, color = '255,255,255') => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${color},${alpha})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  };

  if (type.startsWith('cxr')) drawCXR(g, rng, soft, type);
  else if (type.startsWith('ct_head')) drawCTHead(g, rng, soft, type);
  else if (type === 'ct_appy' || type === 'ct_freefluid') drawCTAbdomen(g, rng, soft, type);
  else if (type.startsWith('mri')) drawMRISpine(g, rng, soft, type);
  else drawAnkle(g, rng, soft, type);

  // film grain + label
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${rng.next() * 0.05})`;
    g.fillRect(rng.next() * 512, rng.next() * 512, 1, 1);
  }
  g.fillStyle = 'rgba(140,190,255,.8)';
  g.font = '14px monospace';
  g.fillText(type.startsWith('ct') ? 'CT' : 'XR', 12, 24);
  g.fillText('MEDTEAM GENERAL', 12, 498);
  return c.toDataURL('image/png');
}

function drawCXR(g, rng, soft, type) {
  // torso glow
  soft(256, 280, 240, 0.10);
  // lung fields (dark = air): draw ribs over them
  g.strokeStyle = 'rgba(255,255,255,.34)';
  g.lineWidth = 7;
  for (let i = 0; i < 8; i++) {
    const y = 90 + i * 42;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(256 + s * 108, y + 26, 105, 42, 0, s === -1 ? Math.PI * 1.05 : Math.PI * 1.55,
        s === -1 ? Math.PI * 1.45 : Math.PI * 1.95);
      g.stroke();
    }
  }
  // spine + heart
  g.fillStyle = 'rgba(255,255,255,.20)';
  g.fillRect(243, 60, 26, 400);
  soft(230, 330, 95, type === 'cxr_hyper' ? 0.16 : 0.30); // heart (smaller/darker when hyperinflated)
  // clavicles
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 9;
  g.beginPath(); g.moveTo(120, 92); g.quadraticCurveTo(256, 60, 392, 92); g.stroke();

  if (type === 'cxr_wide') {
    // widened mediastinum: broad bright central column swallowing the heart
    g.fillStyle = 'rgba(255,255,255,.30)';
    g.fillRect(180, 80, 150, 360);
    soft(255, 250, 130, 0.4);
  } else if (type === 'cxr_ptx') {
    // right lung collapsed: bright pleural edge, missing peripheral markings
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(352, 250, 62, 150, 0.12, -1.4, 1.5); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath(); g.ellipse(420, 250, 55, 170, 0, 0, 7); g.fill();
  } else if (type === 'cxr_infiltrate') {
    for (let i = 0; i < 26; i++) soft(150 + rng.next() * 60, 300 + rng.next() * 90, 26, 0.16);
  } else {
    // faint normal vasculature
    for (let i = 0; i < 22; i++)
      soft(256 + (rng.next() - 0.5) * 250, 130 + rng.next() * 260, 12, 0.05);
  }
  if (type === 'cxr_hyper') {
    // flattened diaphragms, extra-dark stretched fields
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(120, 440); g.lineTo(230, 448); g.stroke();
    g.beginPath(); g.moveTo(282, 448); g.lineTo(400, 440); g.stroke();
  }
}

function drawCTHead(g, rng, soft, type) {
  // skull
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 16;
  g.beginPath(); g.ellipse(256, 256, 172, 205, 0, 0, 7); g.stroke();
  // brain
  soft(256, 256, 175, 0.22);
  // sulci squiggles
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * 6.3, r = 90 + rng.next() * 70;
    g.beginPath();
    g.arc(256 + Math.cos(a) * r * 0.5, 256 + Math.sin(a) * r * 0.55, 18 + rng.next() * 14,
      a, a + 1.2);
    g.stroke();
  }
  // ventricles (dark butterfly) — symmetric when normal
  g.fillStyle = 'rgba(0,0,0,.6)';
  g.beginPath(); g.ellipse(232, 250, 16, 44, 0.35, 0, 7); g.fill();
  g.beginPath(); g.ellipse(280, 250, 16, 44, -0.35, 0, 7); g.fill();
  if (type === 'ct_head_bleed') {
    // hyperdense (bright) blood in the basal cisterns / sulci — the star pattern
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath(); g.moveTo(256, 268);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 5);
      g.lineTo(256 + Math.cos(a) * 58, 286 + Math.sin(a) * 44);
      g.lineTo(256 + Math.cos(a + 0.6) * 20, 286 + Math.sin(a + 0.6) * 16);
    }
    g.closePath(); g.fill();
    soft(256, 286, 70, 0.5);
  }
}

function drawCTAbdomen(g, rng, soft, type) {
  // body oval + subcutaneous fat ring
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 10;
  g.beginPath(); g.ellipse(256, 268, 215, 165, 0, 0, 7); g.stroke();
  soft(256, 268, 200, 0.12);
  // vertebra
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.beginPath(); g.ellipse(256, 390, 34, 26, 0, 0, 7); g.fill();
  // bowel gas blobs
  for (let i = 0; i < 14; i++) {
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.beginPath();
    g.ellipse(150 + rng.next() * 210, 180 + rng.next() * 160, 14 + rng.next() * 18,
      10 + rng.next() * 14, rng.next() * 3, 0, 7);
    g.fill();
  }
  if (type === 'ct_appy') {
    // fat stranding + dilated appendix RLQ (image left = patient right)
    soft(150, 330, 55, 0.5);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 8;
    g.beginPath(); g.arc(150, 330, 22, 0.5, 4.6); g.stroke();
  } else {
    // free fluid: bright crescents in the flanks
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath(); g.ellipse(78, 290, 20, 90, 0.25, 0, 7); g.fill();
    g.beginPath(); g.ellipse(434, 290, 20, 90, -0.25, 0, 7); g.fill();
    soft(256, 200, 60, 0.35);
  }
}

function drawAnkle(g, rng, soft, type) {
  soft(256, 256, 200, 0.06);
  g.strokeStyle = 'rgba(255,255,255,.9)';
  g.lineCap = 'round';
  // tibia + fibula
  g.lineWidth = 34; g.beginPath(); g.moveTo(240, 30); g.lineTo(240, 300); g.stroke();
  g.lineWidth = 14; g.beginPath(); g.moveTo(292, 40); g.lineTo(296, 290); g.stroke();
  // talus + foot
  g.lineWidth = 26; g.beginPath(); g.moveTo(238, 330); g.lineTo(330, 372); g.stroke();
  g.lineWidth = 16; g.beginPath(); g.moveTo(330, 372); g.lineTo(430, 380); g.stroke();
  // malleoli bulbs
  soft(240, 305, 34, 0.7); soft(296, 296, 22, 0.6);
  // soft tissue swelling either way (it's sprained at minimum)
  soft(330, 300, 60, 0.12);
  if (type === 'ankle_fx') {
    // lucent fracture line through distal fibula
    g.strokeStyle = 'rgba(0,0,0,.95)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(284, 250); g.lineTo(308, 268); g.stroke();
  }
}

// sagittal spine MRI: stacked vertebral bodies, dark discs, CSF stripe —
// abscess types get a bright epidural collection pressing the cord
function drawMRISpine(g, rng, soft, type) {
  for (let i = 0; i < 9; i++) {
    const y = 55 + i * 47 + rng.next() * 3;
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.fillRect(200, y - 17, 56, 34);            // vertebral body
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(200, y + 17, 56, 9);             // disc space
  }
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(268, 35, 16, 445);                 // thecal sac / cord
  if (type === 'mri_spine') {                   // epidural collection
    soft(282, 290, 26, 0.55);
    soft(282, 330, 22, 0.5);
    soft(280, 310, 30, 0.35);
  }
}
