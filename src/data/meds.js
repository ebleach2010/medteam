// Pharmacy catalog — cabinet tabs by class. Plenty of near-miss wrong answers
// on purpose; case contraindications make several of them actively dangerous.
export const MEDS = [
  // topicals & simple
  { id: 'antifungal', name: 'Antifungal cream', shelf: 'topicals', color: 0xf2c14e },
  { id: 'steroidcream', name: 'Steroid cream', shelf: 'topicals', color: 0xe8a1c4 },
  { id: 'nsaid', name: 'Ibuprofen', shelf: 'topicals', color: 0xd97b53 },
  { id: 'permethrin', name: 'Permethrin (lice)', shelf: 'topicals', color: 0xb8d97b },
  { id: 'ondansetron', name: 'Ondansetron', shelf: 'topicals', color: 0x7bd9c9 },
  { id: 'laxative', name: 'Laxative', shelf: 'topicals', color: 0xc9a875 },
  { id: 'antihistamine', name: 'Antihistamine', shelf: 'topicals', color: 0xd9c97b },
  { id: 'ors', name: 'Oral rehydration', shelf: 'topicals', color: 0x7bb8d9 },
  { id: 'colchicine', name: 'Colchicine', shelf: 'topicals', color: 0xd9d97b },

  // antibiotics / antimicrobials
  { id: 'amoxicillin', name: 'Amoxicillin', shelf: 'antibiotics', color: 0xf06e9c },
  { id: 'ceftriaxone', name: 'Ceftriaxone', shelf: 'antibiotics', color: 0x76c7f0 },
  { id: 'nitrofurantoin', name: 'Nitrofurantoin', shelf: 'antibiotics', color: 0xc4f076 },
  { id: 'gentamicin', name: 'Gentamicin', shelf: 'antibiotics', color: 0x8e97a8 },
  { id: 'azithromycin', name: 'Azithromycin', shelf: 'antibiotics', color: 0xf0b876 },
  { id: 'vancomycin', name: 'Vancomycin', shelf: 'antibiotics', color: 0xc476f0 },
  { id: 'doxycycline', name: 'Doxycycline', shelf: 'antibiotics', color: 0x76f0a8 },
  { id: 'metronidazole', name: 'Metronidazole', shelf: 'antibiotics', color: 0xf07676 },
  { id: 'acyclovir', name: 'Acyclovir', shelf: 'antibiotics', color: 0x76e2f0 },
  { id: 'fluconazole', name: 'Fluconazole', shelf: 'antibiotics', color: 0xe0f076 },
  { id: 'artesunate', name: 'Artesunate', shelf: 'antibiotics', color: 0x9cf0c9 },
  { id: 'antitoxin', name: 'Antitoxin', shelf: 'antibiotics', color: 0xd0d0e8 },

  // resp / allergy / tox
  { id: 'albuterol', name: 'Albuterol neb', shelf: 'resp', color: 0x6ee0d8 },
  { id: 'steroids', name: 'IV steroids', shelf: 'resp', color: 0xb98ef0 },
  { id: 'epi', name: 'Epinephrine', shelf: 'resp', color: 0xff5d5d },
  { id: 'naloxone', name: 'Naloxone', shelf: 'resp', color: 0x5da8ff },
  { id: 'magnesium', name: 'Magnesium', shelf: 'resp', color: 0xa8ffd0 },
  { id: 'oxygen', name: 'High-flow O₂', shelf: 'resp', color: 0xe8f4ff },
  { id: 'charcoal', name: 'Activated charcoal', shelf: 'resp', color: 0x3a3a42 },
  { id: 'fomepizole', name: 'Fomepizole', shelf: 'resp', color: 0x8ea8f0 },
  { id: 'hydroxocobalamin', name: 'Hydroxocobalamin', shelf: 'resp', color: 0xd05a9e },
  { id: 'flumazenil', name: 'Flumazenil', shelf: 'resp', color: 0xf0d08e },

  // cardiac
  { id: 'aspirin', name: 'Aspirin', shelf: 'cardiac', color: 0xfff3ba },
  { id: 'heparin', name: 'Heparin', shelf: 'cardiac', color: 0x9adcf0 },
  { id: 'metoprolol', name: 'Metoprolol (β-blocker)', shelf: 'cardiac', color: 0xf0b7a1 },
  { id: 'nicardipine', name: 'Nicardipine drip', shelf: 'cardiac', color: 0xffa1e0 },
  { id: 'calcium', name: 'Calcium gluconate', shelf: 'cardiac', color: 0xd8f2a0 },
  { id: 'adenosine', name: 'Adenosine', shelf: 'cardiac', color: 0xa0e2f2 },
  { id: 'amiodarone', name: 'Amiodarone', shelf: 'cardiac', color: 0xf2a0a0 },
  { id: 'atropine', name: 'Atropine', shelf: 'cardiac', color: 0xc9f2a0 },
  { id: 'furosemide', name: 'Furosemide', shelf: 'cardiac', color: 0xf2d8a0 },
  { id: 'nitroglycerin', name: 'Nitroglycerin', shelf: 'cardiac', color: 0xffc9a1 },
  { id: 'digifab', name: 'Digoxin Fab', shelf: 'cardiac', color: 0xa1c9ff },

  // critical / infusions
  { id: 'insulin', name: 'Insulin drip', shelf: 'critical', color: 0xbde0fe },
  { id: 'fluids', name: 'IV fluids', shelf: 'critical', color: 0xa2d2ff },
  { id: 'tpa', name: 'tPA (clot buster)', shelf: 'critical', color: 0xffd23c },
  { id: 'ivig', name: 'IVIG', shelf: 'critical', color: 0xcdb4db },
  { id: 'd50', name: 'D50 glucose', shelf: 'critical', color: 0xffe8a1 },
  { id: 'glucagon', name: 'Glucagon', shelf: 'critical', color: 0xffb4a1 },
  { id: 'prbc', name: 'Blood (PRBC)', shelf: 'critical', color: 0xb01e2e },
  { id: 'bicarb', name: 'Bicarbonate', shelf: 'critical', color: 0xe0e8f4 },
  { id: 'thiamine', name: 'Thiamine', shelf: 'critical', color: 0xf4d0a1 },
  { id: 'potassium', name: 'IV potassium', shelf: 'critical', color: 0xd0a1f4 },
  { id: 'levothyroxine', name: 'Levothyroxine', shelf: 'critical', color: 0xa1f4e2 },
  { id: 'octreotide', name: 'Octreotide', shelf: 'critical', color: 0xf4a1d8 },
  { id: 'hemin', name: 'Hemin', shelf: 'critical', color: 0x8e4a5a },
  { id: 'pyridostigmine', name: 'Pyridostigmine', shelf: 'critical', color: 0xa8d0a1 },

  // sedation / pain / neuro
  { id: 'sedative', name: 'Sedative (IM)', shelf: 'sedation', color: 0x7a5cff },
  { id: 'morphine', name: 'Morphine', shelf: 'sedation', color: 0x5c7cff },
  { id: 'benzo', name: 'Lorazepam', shelf: 'sedation', color: 0x9c7cff },
  { id: 'ketamine', name: 'Ketamine', shelf: 'sedation', color: 0x7cd0ff },
  { id: 'haloperidol', name: 'Haloperidol', shelf: 'sedation', color: 0x5c5cd0 },
  { id: 'levetiracetam', name: 'Levetiracetam', shelf: 'sedation', color: 0xd05cd0 },
];

export const SHELVES = ['topicals', 'antibiotics', 'resp', 'cardiac', 'critical', 'sedation'];
export const medById = (id) => MEDS.find((m) => m.id === id);
