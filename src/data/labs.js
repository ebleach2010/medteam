// Lab PANELS — ordering labs is a real decision now. Each panel matches the
// case-lab keys listed in `match` (regex, case-insensitive). Results only come
// back for panels you ordered; the SPECIALS panel is the catch-all for exotic
// send-out assays (anything no ordinary panel covers).
export const PANELS = [
  { id: 'CBC', label: 'CBC (blood counts)', match: /wbc|hgb|hemoglobin|hct|platelet|eosinophil|schistocyte|smear/i },
  { id: 'CHEM', label: 'Chemistry (BMP/CMP)', match: /^na|sodium|^k\b|k\+|potassium|^cl|hco3|bicarb|bun|^cr\b|creatinine|glucose|calcium|^ca\b|anion|osm/i },
  { id: 'LFT', label: 'Liver panel', match: /ast|alt|bili|alk phos|albumin|ammonia/i },
  { id: 'LIPASE', label: 'Lipase', match: /lipase|amylase/i },
  { id: 'TROP', label: 'Troponin', match: /trop|bnp/i },
  { id: 'COAG', label: 'Coags (PT/INR/D-dimer)', match: /inr|ptt|^pt\b|d.?dimer|fibrinogen/i },
  { id: 'LACT', label: 'Lactate', match: /lactate/i },
  { id: 'GAS', label: 'Blood gas (ABG/VBG)', match: /ph\b|pco2|po2|carboxy|methemoglobin|gap/i },
  { id: 'TOX', label: 'Tox screen + levels', match: /tox|etoh|alcohol|acetaminophen|salicylate|dig|drug|methanol|serotonin/i },
  { id: 'INFECT', label: 'Cultures + infection', match: /culture|procalcitonin|crp|esr|rapid|monospot|thick smear|lumbar|csf/i },
  { id: 'ENDO', label: 'Endocrine (TSH/cortisol)', match: /tsh|t4|cortisol|acth|a1c/i },
  { id: 'UA', label: 'Urinalysis + hCG', match: /urin|hcg|preg|ketone/i },
  { id: 'SPECIALS', label: 'Send-out specials (the weird stuff)', match: null }, // catch-all
];

// which panel would return this case-lab key?
export function panelFor(key) {
  for (const p of PANELS) if (p.match && p.match.test(key)) return p.id;
  return 'SPECIALS';
}

// filter a case's labs down to what was actually ordered.
// Returns rows: [{panel, key, value}] plus a list of ordered-but-normal panels.
export function filterLabs(caseLabs, ordered) {
  const set = new Set(ordered ?? PANELS.map((p) => p.id));
  const rows = [];
  for (const [key, value] of Object.entries(caseLabs ?? {})) {
    if (set.has(panelFor(key))) rows.push({ panel: panelFor(key), key, value });
  }
  const hitPanels = new Set(rows.map((r) => r.panel));
  const normals = [...set].filter((id) => !hitPanels.has(id));
  return { rows, normals };
}
