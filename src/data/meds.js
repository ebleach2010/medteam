// Pharmacy catalog. `shelf` groups meds onto physical shelf units; every med
// here spawns as a grabbable box you rummage for. Plenty of wrong answers on
// purpose — giving the wrong one has real consequences (see case contraindications).
export const MEDS = [
  { id: 'antifungal',  name: 'Antifungal cream',   shelf: 'topicals', color: 0xf2c14e },
  { id: 'steroidcream',name: 'Steroid cream',      shelf: 'topicals', color: 0xe8a1c4 },
  { id: 'nsaid',       name: 'Ibuprofen',          shelf: 'topicals', color: 0xd97b53 },

  { id: 'amoxicillin', name: 'Amoxicillin',        shelf: 'antibiotics', color: 0xf06e9c },
  { id: 'ceftriaxone', name: 'Ceftriaxone',        shelf: 'antibiotics', color: 0x76c7f0 },
  { id: 'nitrofurantoin', name: 'Nitrofurantoin',  shelf: 'antibiotics', color: 0xc4f076 },
  { id: 'gentamicin',  name: 'Gentamicin',         shelf: 'antibiotics', color: 0x8e97a8 },

  { id: 'albuterol',   name: 'Albuterol neb',      shelf: 'resp', color: 0x6ee0d8 },
  { id: 'steroids',    name: 'IV steroids',        shelf: 'resp', color: 0xb98ef0 },
  { id: 'epi',         name: 'Epinephrine',        shelf: 'resp', color: 0xff5d5d },
  { id: 'naloxone',    name: 'Naloxone',           shelf: 'resp', color: 0x5da8ff },

  { id: 'aspirin',     name: 'Aspirin',            shelf: 'cardiac', color: 0xfff3ba },
  { id: 'heparin',     name: 'Heparin',            shelf: 'cardiac', color: 0x9adcf0 },
  { id: 'metoprolol',  name: 'Metoprolol (β-blocker)', shelf: 'cardiac', color: 0xf0b7a1 },
  { id: 'nicardipine', name: 'Nicardipine drip',   shelf: 'cardiac', color: 0xffa1e0 },
  { id: 'calcium',     name: 'Calcium gluconate',  shelf: 'cardiac', color: 0xd8f2a0 },

  { id: 'insulin',     name: 'Insulin drip',       shelf: 'critical', color: 0xbde0fe },
  { id: 'fluids',      name: 'IV fluids',          shelf: 'critical', color: 0xa2d2ff },
  { id: 'tpa',         name: 'tPA (clot buster)',  shelf: 'critical', color: 0xffd23c },
  { id: 'ivig',        name: 'IVIG',               shelf: 'critical', color: 0xcdb4db },

  { id: 'sedative',    name: 'Sedative (IM)',      shelf: 'sedation', color: 0x7a5cff },
  { id: 'morphine',    name: 'Morphine',           shelf: 'sedation', color: 0x5c7cff },
];

export const SHELVES = ['topicals', 'antibiotics', 'resp', 'cardiac', 'critical', 'sedation'];
export const medById = (id) => MEDS.find((m) => m.id === id);
