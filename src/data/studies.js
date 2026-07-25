// Imaging orders, the way you'd actually write them.
//
// You don't order "an x-ray" — you order an x-ray OF SOMETHING. This parses a
// typed request into modality + body region(s) + contrast, so "xr foot",
// "CT head w/ contrast" and "MRI w/wo contrast of head, neck and spine" all
// resolve, and a bare "x-ray" is rejected as an incomplete order.

const MODALITIES = {
  xray: { label: 'X-ray', t: 10, words: ['x-ray', 'xray', 'x ray', 'xr', 'plain film', 'plain films', 'radiograph', 'radiographs', 'film', 'films'] },
  ct: { label: 'CT', t: 20, words: ['ct', 'cat scan', 'computed tomography', 'ctа'] },
  cta: { label: 'CT angiogram', t: 26, words: ['cta', 'ct angio', 'ct angiogram', 'angiogram', 'angiography'] },
  mri: { label: 'MRI', t: 45, words: ['mri', 'magnetic resonance', 'mr '] },
  us: { label: 'Ultrasound', t: 14, words: ['ultrasound', 'u/s', 'us ', 'sonogram', 'sonography', 'doppler', 'fast scan', 'fast exam'] },
  echo: { label: 'Echocardiogram', t: 20, words: ['echo', 'echocardiogram', 'tte', 'bubble study'] },
  ekg: { label: '12-lead EKG', t: 6, words: ['ekg', 'ecg', '12 lead', '12-lead', 'electrocardiogram'] },
  scope: { label: 'Endoscopy', t: 35, words: ['endoscopy', 'scope', 'egd', 'colonoscopy', 'gastroscopy'] },
};

// body regions. `also` covers what a region implicitly includes (a CT abdomen
// and pelvis covers the pelvis; a chest film covers the ribs).
const REGIONS = {
  head: { label: 'head', words: ['head', 'brain', 'skull', 'cranial', 'cranium', 'intracranial'] },
  neck: { label: 'neck', words: ['neck', 'cervical', 'c-spine', 'c spine', 'carotid', 'throat'] },
  chest: { label: 'chest', words: ['chest', 'thorax', 'thoracic', 'lung', 'lungs', 'cxr', 'ribs', 'pulmonary', 'pe protocol'] },
  abdomen: { label: 'abdomen/pelvis', words: ['abdomen', 'abdominal', 'abdo', 'belly', 'pelvis', 'pelvic', 'kub', 'appendix', 'liver', 'gallbladder', 'renal', 'kidney', 'kidneys', 'ureter'] },
  spine: { label: 'spine', words: ['spine', 'spinal', 'lumbar', 'l-spine', 'l spine', 'thoracic spine', 't-spine', 'back', 'vertebra', 'vertebral'] },
  ankle: { label: 'ankle/foot', words: ['ankle', 'foot', 'feet', 'toe', 'toes', 'calcaneus', 'metatarsal'] },
  knee: { label: 'knee/leg', words: ['knee', 'leg', 'tibia', 'fibula', 'femur', 'thigh'] },
  arm: { label: 'arm/hand', words: ['arm', 'hand', 'wrist', 'elbow', 'forearm', 'humerus', 'radius', 'ulna', 'finger', 'shoulder'] },
  hip: { label: 'hip', words: ['hip', 'pelvic ring', 'acetabulum'] },
  heart: { label: 'heart', words: ['heart', 'cardiac', 'coronary'] },
};

const CONTRAST = {
  with: ['with contrast', 'w/ contrast', 'w contrast', 'contrast enhanced', 'iv contrast', 'with iv contrast'],
  both: ['w/ w/o', 'w/wo', 'with and without', 'w and w/o', 'with/without', 'w/ and w/o'],
  without: ['without contrast', 'w/o contrast', 'wo contrast', 'non contrast', 'noncontrast', 'non-contrast'],
};

// Which study each case's imaging finding actually requires. If the order
// doesn't match on BOTH modality and region, the report comes back clean —
// which is exactly what a wrongly-targeted scan does in real life.
export const REQUIRED = {
  ankle: { modality: 'xray', region: 'ankle' },
  cxr_infiltrate: { modality: 'xray', region: 'chest' },
  cxr_ptx: { modality: 'xray', region: 'chest' },
  ct_head_normal: { modality: 'ct', region: 'head' },
  ct_head_bleed: { modality: 'ct', region: 'head' },
  ct_appendicitis: { modality: 'ct', region: 'abdomen' },
  ct_freefluid: { modality: 'us', region: 'abdomen' },
  ekg: { modality: 'ekg', region: 'heart' },
  echo: { modality: 'echo', region: 'heart' },
};

const norm = (s) => ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/**
 * Parse a typed imaging order.
 * @returns { ok, modality, regions[], contrast, label, t, why }
 *          ok:false with `why` when it's not a complete order.
 */
export function parseStudy(text) {
  const q = norm(text);
  if (!q.trim()) return { ok: false, why: 'Order a study — modality and body part. e.g. "x-ray ankle".' };

  // modality: longest match wins ("ct angio" beats "ct")
  let modality = null, best = 0;
  for (const [id, m] of Object.entries(MODALITIES)) {
    for (const w of m.words) {
      if (q.includes(` ${w.trim()} `) || q.includes(` ${w.trim()}`) === false && q.includes(w)) {
        if (w.length > best) { best = w.length; modality = id; }
      }
    }
  }
  if (!modality) {
    return { ok: false, why: 'Which study? X-ray, ultrasound, CT, CTA, MRI, echo, EKG or endoscopy.' };
  }

  // regions — a request can name several ("head, neck and spine")
  const regions = [];
  for (const [id, r] of Object.entries(REGIONS)) {
    if (r.words.some((w) => q.includes(w))) regions.push(id);
  }
  // EKG/echo are inherently cardiac — no region needed
  if (!regions.length && (modality === 'ekg' || modality === 'echo')) regions.push('heart');
  if (!regions.length) {
    return { ok: false, modality, why: `${MODALITIES[modality].label} of WHAT? Name the body part — "${MODALITIES[modality].label.toLowerCase()} chest", "…head", "…ankle".` };
  }

  let contrast = 'none';
  if (CONTRAST.both.some((w) => q.includes(w))) contrast = 'both';
  else if (CONTRAST.with.some((w) => q.includes(w))) contrast = 'with';
  else if (CONTRAST.without.some((w) => q.includes(w))) contrast = 'without';

  const M = MODALITIES[modality];
  const label = `${M.label} ${regions.map((r) => REGIONS[r].label).join(' + ')}${
    contrast === 'both' ? ' w/ & w/o contrast' : contrast === 'with' ? ' w/ contrast'
      : contrast === 'without' ? ' w/o contrast' : ''}`;
  // more regions and contrast phases take longer in the scanner
  const t = Math.round(M.t * (1 + (regions.length - 1) * 0.55) * (contrast === 'both' ? 1.6 : contrast === 'with' ? 1.25 : 1));
  return { ok: true, modality, regions, contrast, label, t };
}

// Does this order actually image the thing that's wrong with them?
export function studyMatches(study, imagingType) {
  const req = REQUIRED[imagingType];
  if (!req || !study?.ok) return false;
  // an MRI or CT of the right region is acceptable where a plain film is asked
  // for (over-imaging costs time, not accuracy); a plain film cannot replace
  // cross-sectional imaging.
  const rank = { xray: 1, us: 2, ekg: 2, echo: 2, ct: 3, cta: 3, scope: 3, mri: 4 };
  const okModality = study.modality === req.modality
    || (rank[study.modality] ?? 0) > (rank[req.modality] ?? 9);
  return okModality && study.regions.includes(req.region);
}

export const MODALITY_LIST = Object.entries(MODALITIES).map(([id, m]) => ({ id, label: m.label }));
export const REGION_LIST = Object.entries(REGIONS).map(([id, r]) => ({ id, label: r.label }));
