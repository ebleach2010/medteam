// Pharmacy catalog.
//
// Every entry carries its drug CLASSES, a typical adult ED dose, and rough
// pharmacokinetics (onset in minutes, duration in minutes). Presentations
// prescribe by CLASS, not by id — so a panic attack asks for an anxiolytic and
// lorazepam, diazepam, hydroxyzine or midazolam all satisfy it. That's what
// keeps treatment from being a guess-the-exact-name puzzle.
//
// cls  — classes this agent belongs to (matched against a presentation's rx)
// dose — what you'd actually give an adult in the department
// onset/dur — minutes; how fast the response shows and how long it holds
const M = (id, name, shelf, color, cls, dose, onset, dur, note) =>
  ({ id, name, shelf, color, cls, dose, onset, dur, note });

export const MEDS = [
  // ---------- topicals & simple ----------
  M('antifungal', 'Antifungal cream', 'topicals', 0xf2c14e, ['antifungal', 'topical'], 'Clotrimazole 1% BID', 60, 720),
  M('steroidcream', 'Steroid cream', 'topicals', 0xe8a1c4, ['corticosteroid-topical', 'topical'], 'Triamcinolone 0.1% BID', 60, 720),
  M('nsaid', 'Ibuprofen', 'topicals', 0xd97b53, ['nsaid', 'analgesic-mild', 'antipyretic'], '600 mg PO', 30, 360),
  M('acetaminophen', 'Acetaminophen', 'topicals', 0xe8c9a1, ['analgesic-mild', 'antipyretic'], '1 g PO/IV', 30, 300),
  M('ketorolac', 'Ketorolac (IV NSAID)', 'topicals', 0xd9694a, ['nsaid', 'analgesic-mild', 'analgesic-moderate'], '15 mg IV', 10, 360),
  M('permethrin', 'Permethrin (lice/scabies)', 'topicals', 0xb8d97b, ['antiparasitic', 'topical'], '5% cream, single application', 60, 1440),
  M('ondansetron', 'Ondansetron', 'topicals', 0x7bd9c9, ['antiemetic'], '4 mg IV/ODT', 15, 360),
  M('laxative', 'Laxative', 'topicals', 0xc9a875, ['laxative'], 'Polyethylene glycol 17 g PO', 360, 1440),
  M('antihistamine', 'Diphenhydramine', 'topicals', 0xd9c97b, ['antihistamine', 'sedative-hypnotic'], '25–50 mg IV/PO', 20, 300),
  M('ors', 'Oral rehydration', 'topicals', 0x7bb8d9, ['fluid'], 'ORS sachet, sip to tolerance', 30, 480),
  M('colchicine', 'Colchicine', 'topicals', 0xd9d97b, ['antigout'], '1.2 mg PO then 0.6 mg', 60, 720),
  M('tetanus', 'Tetanus booster', 'topicals', 0xa1c9a1, ['vaccine', 'wound-care'], 'Td/Tdap 0.5 mL IM', 0, 0),
  M('lidocaine', 'Lidocaine (local)', 'topicals', 0xf0e0a1, ['local-anesthetic', 'wound-care'], '1% infiltration', 3, 90),

  // ---------- antibiotics / antimicrobials ----------
  M('amoxicillin', 'Amoxicillin', 'antibiotics', 0xf06e9c, ['antibiotic', 'penicillin'], '500 mg PO TID', 60, 480),
  M('ceftriaxone', 'Ceftriaxone', 'antibiotics', 0x76c7f0, ['antibiotic', 'cephalosporin', 'antibiotic-broad'], '1–2 g IV', 30, 1440),
  M('cephalexin', 'Cephalexin', 'antibiotics', 0x8ed6f0, ['antibiotic', 'cephalosporin', 'antibiotic-skin'], '500 mg PO QID', 60, 360),
  M('nitrofurantoin', 'Nitrofurantoin', 'antibiotics', 0xc4f076, ['antibiotic', 'antibiotic-uti'], '100 mg PO BID', 60, 720),
  M('gentamicin', 'Gentamicin', 'antibiotics', 0x8e97a8, ['antibiotic', 'aminoglycoside'], '5 mg/kg IV', 30, 1440),
  M('azithromycin', 'Azithromycin', 'antibiotics', 0xf0b876, ['antibiotic', 'macrolide', 'antibiotic-resp'], '500 mg PO/IV', 60, 1440),
  M('vancomycin', 'Vancomycin', 'antibiotics', 0xc476f0, ['antibiotic', 'antibiotic-broad', 'antibiotic-skin', 'mrsa'], '15–20 mg/kg IV', 60, 720),
  M('doxycycline', 'Doxycycline', 'antibiotics', 0x76f0a8, ['antibiotic', 'tetracycline', 'antibiotic-skin'], '100 mg PO BID', 60, 720),
  M('metronidazole', 'Metronidazole', 'antibiotics', 0xf07676, ['antibiotic', 'anaerobic'], '500 mg IV/PO TID', 60, 480),
  M('piptazo', 'Piperacillin-tazobactam', 'antibiotics', 0xf0a1c9, ['antibiotic', 'antibiotic-broad'], '4.5 g IV q6h', 30, 360),
  M('acyclovir', 'Acyclovir', 'antibiotics', 0x76e2f0, ['antiviral'], '400 mg PO 5×/day', 60, 300),
  M('oseltamivir', 'Oseltamivir', 'antibiotics', 0x9ed6e8, ['antiviral'], '75 mg PO BID', 90, 720),
  M('fluconazole', 'Fluconazole', 'antibiotics', 0xe0f076, ['antifungal'], '150 mg PO once', 120, 1440),
  M('artesunate', 'Artesunate', 'antibiotics', 0x9cf0c9, ['antiparasitic'], '2.4 mg/kg IV', 30, 720),
  M('antitoxin', 'Antitoxin', 'antibiotics', 0xd0d0e8, ['antitoxin', 'antidote'], 'per protocol', 30, 2880),

  // ---------- resp / allergy / tox ----------
  M('albuterol', 'Albuterol neb', 'resp', 0x6ee0d8, ['bronchodilator'], '2.5 mg neb', 5, 240),
  M('ipratropium', 'Ipratropium', 'resp', 0x8ee8e0, ['bronchodilator', 'anticholinergic'], '0.5 mg neb', 15, 300),
  M('steroids', 'IV steroids', 'resp', 0xb98ef0, ['corticosteroid'], 'Methylprednisolone 125 mg IV', 60, 720),
  M('prednisone', 'Prednisone', 'resp', 0xc9a1f0, ['corticosteroid'], '40–60 mg PO daily', 60, 1440),
  M('epi', 'Epinephrine', 'resp', 0xff5d5d, ['vasopressor', 'anaphylaxis'], '0.3–0.5 mg IM (1:1000)', 3, 30),
  M('naloxone', 'Naloxone', 'resp', 0x5da8ff, ['antidote', 'reversal-opioid'], '0.4–2 mg IV/IM/IN', 2, 60),
  M('magnesium', 'Magnesium', 'resp', 0xa8ffd0, ['electrolyte', 'bronchodilator-adjunct', 'anticonvulsant'], '2 g IV', 15, 300),
  M('oxygen', 'High-flow O₂', 'resp', 0xe8f4ff, ['oxygen'], '15 L NRB / titrate', 1, 0),
  M('charcoal', 'Activated charcoal', 'resp', 0x3a3a42, ['decontamination'], '1 g/kg PO', 15, 120),
  M('fomepizole', 'Fomepizole', 'resp', 0x8ea8f0, ['antidote'], '15 mg/kg IV load', 30, 720),
  M('hydroxocobalamin', 'Hydroxocobalamin', 'resp', 0xd05a9e, ['antidote'], '5 g IV', 10, 480),
  M('flumazenil', 'Flumazenil', 'resp', 0xf0d08e, ['antidote', 'reversal-benzo'], '0.2 mg IV', 2, 60),
  M('nac', 'N-acetylcysteine', 'resp', 0xc9e8a1, ['antidote'], '150 mg/kg IV load', 30, 1200),

  // ---------- cardiac ----------
  M('aspirin', 'Aspirin', 'cardiac', 0xfff3ba, ['antiplatelet', 'nsaid'], '324 mg chewed', 20, 1440),
  M('heparin', 'Heparin', 'cardiac', 0x9adcf0, ['anticoagulant'], '60 u/kg bolus + drip', 10, 240),
  M('metoprolol', 'Metoprolol (β-blocker)', 'cardiac', 0xf0b7a1, ['beta-blocker', 'rate-control'], '5 mg IV q5min ×3', 10, 360),
  M('propranolol', 'Propranolol', 'cardiac', 0xf0c9a1, ['beta-blocker', 'anxiolytic-somatic'], '10–40 mg PO', 30, 360),
  M('diltiazem', 'Diltiazem', 'cardiac', 0xffb8c9, ['ccb', 'rate-control'], '0.25 mg/kg IV', 5, 240),
  M('nicardipine', 'Nicardipine drip', 'cardiac', 0xffa1e0, ['ccb', 'antihypertensive'], '5 mg/h IV, titrate', 10, 120),
  M('labetalol', 'Labetalol', 'cardiac', 0xe8a1c9, ['beta-blocker', 'antihypertensive'], '10–20 mg IV', 7, 240),
  M('hydralazine', 'Hydralazine', 'cardiac', 0xf0a1b8, ['vasodilator', 'antihypertensive'], '10 mg IV', 15, 360),
  M('calcium', 'Calcium gluconate', 'cardiac', 0xd8f2a0, ['electrolyte', 'membrane-stabilizer'], '1 g IV', 3, 60),
  M('adenosine', 'Adenosine', 'cardiac', 0xa0e2f2, ['antiarrhythmic'], '6 mg rapid IV push', 1, 2),
  M('amiodarone', 'Amiodarone', 'cardiac', 0xf2a0a0, ['antiarrhythmic'], '150 mg IV over 10 min', 10, 720),
  M('atropine', 'Atropine', 'cardiac', 0xc9f2a0, ['anticholinergic', 'chronotrope'], '1 mg IV q3–5min', 2, 90),
  M('furosemide', 'Furosemide', 'cardiac', 0xf2d8a0, ['diuretic'], '40 mg IV', 15, 360),
  M('nitroglycerin', 'Nitroglycerin', 'cardiac', 0xffc9a1, ['vasodilator', 'antianginal'], '0.4 mg SL q5min', 3, 30),
  M('digifab', 'Digoxin Fab', 'cardiac', 0xa1c9ff, ['antidote'], 'per level/protocol', 30, 1440),
  M('norepi', 'Norepinephrine', 'cardiac', 0xd08e8e, ['vasopressor'], '0.05 µg/kg/min, titrate', 2, 10),

  // ---------- critical / infusions ----------
  M('insulin', 'Insulin drip', 'critical', 0xbde0fe, ['insulin'], '0.1 u/kg/h IV', 15, 60),
  M('fluids', 'IV fluids', 'critical', 0xa2d2ff, ['fluid', 'resuscitation'], '1–2 L crystalloid bolus', 10, 240),
  M('tpa', 'tPA (clot buster)', 'critical', 0xffd23c, ['thrombolytic'], '0.9 mg/kg IV', 30, 240),
  M('txa', 'Tranexamic acid', 'critical', 0xffe08a, ['antifibrinolytic'], '1 g IV over 10 min', 20, 480),
  M('ivig', 'IVIG', 'critical', 0xcdb4db, ['immunoglobulin'], '0.4 g/kg/day IV', 240, 2880),
  M('d50', 'D50 glucose', 'critical', 0xffe8a1, ['glucose'], '25 g IV', 2, 120),
  M('glucagon', 'Glucagon', 'critical', 0xffb4a1, ['glucose', 'antidote'], '1 mg IM', 10, 90),
  M('prbc', 'Blood (PRBC)', 'critical', 0xb01e2e, ['blood-product', 'resuscitation'], '1–2 units', 30, 1440),
  M('bicarb', 'Bicarbonate', 'critical', 0xe0e8f4, ['alkalinizer', 'electrolyte'], '1 mEq/kg IV', 5, 120),
  M('thiamine', 'Thiamine', 'critical', 0xf4d0a1, ['vitamin', 'withdrawal'], '100–500 mg IV', 30, 1440),
  M('potassium', 'IV potassium', 'critical', 0xd0a1f4, ['electrolyte'], '10 mEq/h IV', 30, 360),
  M('levothyroxine', 'Levothyroxine', 'critical', 0xa1f4e2, ['thyroid'], '200–400 µg IV', 360, 2880),
  M('octreotide', 'Octreotide', 'critical', 0xf4a1d8, ['somatostatin'], '50 µg IV then drip', 20, 480),
  M('hemin', 'Hemin', 'critical', 0x8e4a5a, ['heme'], '3–4 mg/kg IV', 240, 2880),
  M('pyridostigmine', 'Pyridostigmine', 'critical', 0xa8d0a1, ['cholinesterase-inhibitor'], '60 mg PO', 45, 240),
  M('vitk', 'Vitamin K', 'critical', 0xd8f0a1, ['reversal-anticoagulant'], '10 mg IV', 360, 1440),

  // ---------- sedation / pain / neuro ----------
  M('sedative', 'Midazolam (IM)', 'sedation', 0x7a5cff, ['benzodiazepine', 'anxiolytic', 'sedative-hypnotic', 'agitation'], '5 mg IM', 10, 120),
  M('morphine', 'Morphine', 'sedation', 0x5c7cff, ['analgesic-opioid', 'analgesic-severe', 'analgesic-moderate'], '4 mg IV q10min', 10, 240),
  M('fentanyl', 'Fentanyl', 'sedation', 0x6e8eff, ['analgesic-opioid', 'analgesic-severe'], '50–100 µg IV', 3, 45),
  M('benzo', 'Lorazepam', 'sedation', 0x9c7cff, ['benzodiazepine', 'anxiolytic', 'sedative-hypnotic', 'anticonvulsant', 'withdrawal'], '1–2 mg IV/PO', 15, 480),
  M('diazepam', 'Diazepam', 'sedation', 0x8c6cff, ['benzodiazepine', 'anxiolytic', 'anticonvulsant', 'muscle-relaxant', 'withdrawal'], '5–10 mg IV/PO', 10, 720),
  M('ketamine', 'Ketamine', 'sedation', 0x7cd0ff, ['dissociative', 'analgesic-severe', 'sedative-hypnotic', 'agitation'], '1 mg/kg IV', 2, 20),
  M('haloperidol', 'Haloperidol', 'sedation', 0x5c5cd0, ['antipsychotic', 'agitation'], '5 mg IM', 20, 360),
  M('levetiracetam', 'Levetiracetam', 'sedation', 0xd05cd0, ['anticonvulsant'], '1 g IV', 30, 720),
  M('sumatriptan', 'Sumatriptan', 'sedation', 0xd08ed0, ['triptan', 'antimigraine'], '6 mg SC', 15, 240),
  M('prochlorperazine', 'Prochlorperazine', 'sedation', 0xc9a1d8, ['antiemetic', 'antimigraine'], '10 mg IV', 15, 360),
  M('methocarbamol', 'Methocarbamol', 'sedation', 0xa1a1d8, ['muscle-relaxant'], '1 g IV/PO', 30, 360),
  M('cyclobenzaprine', 'Cyclobenzaprine', 'sedation', 0xb8b8e0, ['muscle-relaxant'], '10 mg PO', 60, 720),
  M('gabapentin', 'Gabapentin', 'sedation', 0xc9c9f0, ['neuropathic-analgesic'], '300 mg PO', 90, 480),

  // ---------- psych ----------
  M('quetiapine', 'Quetiapine (Seroquel)', 'psych', 0x9a7fd0, ['antipsychotic', 'sedative-hypnotic', 'mood-stabilizer'], '25–100 mg PO', 60, 720),
  M('olanzapine', 'Olanzapine', 'psych', 0xa98ee0, ['antipsychotic', 'agitation', 'sedative-hypnotic'], '5–10 mg IM/ODT', 30, 720),
  M('risperidone', 'Risperidone', 'psych', 0xb89ee8, ['antipsychotic'], '1–2 mg PO', 60, 1440),
  M('trazodone', 'Trazodone', 'psych', 0x8e9ed0, ['sedative-hypnotic', 'antidepressant'], '50 mg PO qHS', 60, 480),
  M('zolpidem', 'Zolpidem', 'psych', 0x9eb8e0, ['sedative-hypnotic'], '5–10 mg PO qHS', 30, 360),
  M('melatonin', 'Melatonin', 'psych', 0xc9d8f0, ['sedative-hypnotic'], '3–5 mg PO qHS', 60, 480),
  M('buspirone', 'Buspirone', 'psych', 0xa1b8d0, ['anxiolytic'], '7.5 mg PO BID', 120, 480),
  M('hydroxyzine', 'Hydroxyzine', 'psych', 0xb8c9e0, ['anxiolytic', 'antihistamine', 'sedative-hypnotic'], '25–50 mg PO/IM', 30, 360),
  M('sertraline', 'Sertraline', 'psych', 0x8ed0c9, ['antidepressant'], '50 mg PO daily', 1440, 1440),
  M('lithium', 'Lithium', 'psych', 0xd0d0d8, ['mood-stabilizer'], '300 mg PO', 240, 720),
  M('nicotine', 'Nicotine patch', 'psych', 0xd8c9a1, ['withdrawal'], '21 mg/24 h', 60, 1440),
  M('chlordiazepoxide', 'Chlordiazepoxide', 'psych', 0xa88ed0, ['benzodiazepine', 'anxiolytic', 'withdrawal'], '25–50 mg PO', 60, 1440),

  // ---------- GI / GU ----------
  M('pantoprazole', 'Pantoprazole', 'gi', 0x8ed0a1, ['ppi', 'acid-suppression'], '40 mg IV', 30, 720),
  M('famotidine', 'Famotidine', 'gi', 0xa1d8b8, ['h2-blocker', 'acid-suppression'], '20 mg IV/PO', 30, 720),
  M('sucralfate', 'Sucralfate', 'gi', 0xc9e0b8, ['mucosal-protectant', 'acid-suppression'], '1 g PO QID', 30, 360),
  M('dicyclomine', 'Dicyclomine', 'gi', 0xb8e0c9, ['antispasmodic'], '20 mg PO/IM', 60, 360),
  M('loperamide', 'Loperamide', 'gi', 0xd0e8b8, ['antidiarrheal'], '4 mg PO then 2 mg', 60, 480),
  M('tamsulosin', 'Tamsulosin', 'gi', 0xa1c9d8, ['alpha-blocker', 'urologic'], '0.4 mg PO daily', 240, 1440),
  M('gicocktail', 'GI cocktail', 'gi', 0xc9d8a1, ['antacid', 'acid-suppression'], 'antacid + viscous lidocaine', 10, 180),
];

export const SHELVES = ['topicals', 'antibiotics', 'resp', 'cardiac', 'critical', 'sedation', 'psych', 'gi'];
export const medById = (id) => MEDS.find((m) => m.id === id);

// every med carrying a given class (used by the presentation engine)
export const medsInClass = (cls) => MEDS.filter((m) => m.cls.includes(cls));
export const medHasClass = (id, cls) => !!medById(id)?.cls.includes(cls);
