// ED presentations, ordered the way they actually walk through the door.
//
// This replaces the old fixed 500-diagnosis reference table, which demanded one
// exact answer per case and made reasonable medicine feel wrong. Here each
// presentation prescribes by CLASS and lists several acceptable routes:
//
//   first — the textbook move (full credit)
//   alt   — other defensible agents (full credit)
//   adj   — adjuncts that help but don't fix it alone (partial credit)
//
// `w` is a frequency weight ≈ how often that complaint hits a real department
// (NHAMCS-shaped: abdominal pain and chest pain dominate, torsades does not).
// The generator samples by weight and then randomises severity, vitals,
// demography and per-patient drug response, so the same presentation plays
// differently every time.
//
// esi — Emergency Severity Index 1 (resuscitation) … 5 (nonurgent). Drives the
// triage nurse's ordering of the waiting room.

const SYSTEM_OF = {'abdo_pain': 'gi', 'chest_pain_atyp': 'cardiac', 'uri': 'infect', 'lowback': 'msk', 'headache_tension': 'neuro', 'migraine': 'neuro', 'gastro': 'gi', 'uti': 'gu', 'sprain': 'msk', 'laceration': 'msk', 'rash_allergic': 'derm', 'dental': 'infect', 'cellulitis': 'infect', 'conjunctivitis': 'eye', 'constipation': 'gi', 'asthma': 'resp', 'copd': 'resp', 'pneumonia': 'resp', 'renal_colic': 'gu', 'anxiety_insomnia': 'psych', 'panic': 'psych', 'etoh_withdrawal': 'psych', 'opioid_od': 'tox', 'paracetamol_od': 'tox', 'suicidal': 'psych', 'psychosis': 'psych', 'syncope': 'cardiac', 'afib_rvr': 'cardiac', 'hypoglycemia': 'endo', 'appendicitis': 'gi', 'anaphylaxis': 'resp', 'sepsis': 'infect', 'stemi': 'cardiac', 'gi_bleed': 'gi', 'dka': 'endo', 'stroke_isch': 'neuro', 'sah': 'neuro', 'pneumothorax': 'resp', 'ectopic': 'gu', 'meningitis': 'infect', 'hyperkalemia': 'endo', 'status_epilepticus': 'neuro'};

const P = (id, name, esi, w, complaint, o = {}) => ({
  id, name, esi, w,
  complaint: Array.isArray(complaint) ? complaint : [complaint],
  history: o.hx ?? 'Nothing relevant.',
  rx: { first: o.first ?? [], alt: o.alt ?? [], adj: o.adj ?? [] },
  dx: o.dx ?? [name],
  fail: o.fail ?? null,           // null = won't kill them, just miserable
  dispo: o.dispo ?? 'discharge',
  v: o.v ?? {},                   // vitals deltas from normal
  labs: o.labs ?? undefined,
  img: o.img ?? null,
  surgery: o.surgery ?? undefined,
  contra: o.contra ?? [],
  agit: o.agit ?? 0,
  psych: o.psych ?? false,
  tags: o.tags ?? [],
  sys: o.sys ?? SYSTEM_OF[id] ?? 'gi',
  // self-limited: good SUPPORTIVE care (rest, warmth, comfort, a topical) is
  // itself curative after a recheck window — you don't owe them a specific
  // drug. Distinct from cases that genuinely need the right agent.
  supportiveDefinitive: o.supportiveDefinitive ?? false,
});

export const PRESENTATIONS = [
  // ======================= very common, low acuity =======================
  P('abdo_pain', 'Nonspecific abdominal pain', 4, 100,
    ['My stomach has been killing me since last night.', 'Belly pain. Comes in waves.'],
    { hx: 'No surgeries. Ate something questionable.', first: ['antispasmodic', 'analgesic-mild'],
      alt: ['antiemetic', 'acid-suppression'], adj: ['fluid'],
      dx: ['Nonspecific abdominal pain', 'Gastritis', 'Appendicitis', 'Constipation'], v: { hr: 88 } }),

  P('chest_pain_atyp', 'Atypical chest pain', 3, 92,
    ['Chest feels tight. I thought I was having a heart attack.', 'Pressure in my chest, on and off.'],
    { hx: 'Family history of heart disease. Stressed at work.', first: ['antiplatelet'],
      alt: ['antianginal', 'acid-suppression'], adj: ['analgesic-mild', 'anxiolytic'],
      dx: ['Atypical chest pain', 'GERD', 'Costochondritis', 'ACS'], v: { hr: 92, sbp: 138 },
      labs: { Troponin: 'negative ×2', ECG: 'sinus, no ischemia' } }),

  P('uri', 'Upper respiratory infection', 5, 88,
    ['I have had this cough for a week and I feel awful.', 'Sore throat, stuffy, coughing.'],
    { hx: 'Kids brought something home from school.', first: ['antipyretic'],
      alt: ['analgesic-mild'], adj: ['fluid', 'supportive'], supportiveDefinitive: true,
      dx: ['Viral URI', 'Strep pharyngitis', 'Influenza', 'Pneumonia'], v: { temp: 37.9 } }),

  P('lowback', 'Mechanical low back pain', 4, 84,
    ['I picked up a couch and my back went.', 'Lower back is in spasm.'],
    { hx: 'Moving apartments. No numbness, no incontinence.', first: ['nsaid', 'muscle-relaxant'],
      alt: ['analgesic-mild', 'analgesic-moderate'], adj: ['neuropathic-analgesic', 'supportive'],
      supportiveDefinitive: true,
      dx: ['Mechanical back pain', 'Disc herniation', 'Cauda equina', 'Pyelonephritis'] }),

  P('headache_tension', 'Tension headache', 4, 78,
    ['Band around my head. All day.', 'Headache that will not quit.'],
    { hx: 'Deadlines. Poor sleep. Too much coffee.', first: ['analgesic-mild'],
      alt: ['nsaid', 'antiemetic'], adj: ['fluid', 'supportive'], supportiveDefinitive: true,
      dx: ['Tension headache', 'Migraine', 'SAH', 'Meningitis'] }),

  P('migraine', 'Migraine', 3, 70,
    ['Left side of my head is throbbing and the lights are evil.', 'Migraine. I need a dark room.'],
    { hx: 'Known migraines, out of my usual meds.', first: ['antimigraine'],
      alt: ['antiemetic', 'nsaid'], adj: ['fluid', 'analgesic-mild'],
      dx: ['Migraine', 'Tension headache', 'SAH', 'Sinusitis'] }),

  P('gastro', 'Gastroenteritis', 4, 76,
    ['Both ends. For two days. It is grim.', 'Vomiting and diarrhoea since yesterday.'],
    { hx: 'Roommate had it first.', first: ['antiemetic', 'fluid'],
      alt: ['antidiarrheal'], adj: ['analgesic-mild', 'supportive'], supportiveDefinitive: true,
      dx: ['Viral gastroenteritis', 'Food poisoning', 'C. diff', 'Appendicitis'],
      v: { hr: 98, sbp: 112 }, labs: { BMP: 'Cr 1.3, mild AKI' } }),

  P('uti', 'Urinary tract infection', 4, 72,
    ['It burns every time I pee.', 'Peeing constantly and it stings.'],
    { hx: 'Had these before.', first: ['antibiotic-uti'], alt: ['antibiotic'], adj: ['analgesic-mild', 'fluid'],
      dx: ['UTI / cystitis', 'Pyelonephritis', 'Kidney stone', 'STI'],
      v: { temp: 37.6 }, labs: { UA: 'nitrite +, leuks +' } }),

  P('sprain', 'Ankle sprain', 4, 68,
    ['Rolled my ankle playing football. It is the size of a grapefruit.', 'Twisted my ankle on a kerb.'],
    { hx: 'Weekend league. Heard a pop.', first: ['nsaid'], alt: ['analgesic-mild', 'analgesic-moderate'],
      adj: ['supportive'], supportiveDefinitive: true,
      dx: ['Ankle sprain', 'Ankle fracture', 'Achilles rupture', 'Gout'],
      img: { type: 'ankle', options: ['No fracture — sprain', 'Distal fibula fracture', 'Normal', 'Dislocation'] } }),

  P('laceration', 'Laceration', 4, 62,
    ['Cut my hand on a tin. It will not stop bleeding.', 'Sliced my finger chopping onions.'],
    { hx: 'Kitchen accident. Tetanus... a while ago?', first: ['wound-care'],
      alt: ['local-anesthetic', 'vaccine'], adj: ['antibiotic-skin', 'analgesic-mild'],
      dx: ['Simple laceration', 'Tendon injury', 'Retained foreign body', 'Nerve injury'],
      fail: 'bleed', v: { hr: 90 } }),

  P('rash_allergic', 'Allergic reaction / urticaria', 4, 60,
    ['I came out in hives everywhere and I am itching out of my skin.', 'Blotchy rash all over.'],
    { hx: 'New antibiotic three days ago.', first: ['antihistamine'],
      alt: ['corticosteroid'], adj: ['corticosteroid-topical'],
      dx: ['Urticaria / allergic reaction', 'Anaphylaxis', 'Contact dermatitis', 'Cellulitis'],
      v: { hr: 94 } }),

  P('dental', 'Dental abscess', 4, 52,
    ['My tooth. My whole face. Please.', 'Toothache for three days and my cheek is swollen.'],
    { hx: 'Have not seen a dentist in years.', first: ['antibiotic'],
      alt: ['antibiotic-skin', 'anaerobic'], adj: ['analgesic-moderate', 'nsaid'],
      dx: ['Dental abscess', 'Ludwig angina', 'Sinusitis', 'TMJ dysfunction'], v: { temp: 37.8 } }),

  P('cellulitis', 'Cellulitis', 3, 56,
    ['My leg is red and hot and spreading.', 'This bite got infected and it is going up my arm.'],
    { hx: 'Scratched it a few days ago.', first: ['antibiotic-skin'],
      alt: ['antibiotic', 'antibiotic-broad'], adj: ['analgesic-mild', 'antipyretic'],
      dx: ['Cellulitis', 'Abscess', 'DVT', 'Necrotising fasciitis'],
      fail: 'shock', v: { temp: 38.2, hr: 96 } }),

  P('conjunctivitis', 'Conjunctivitis', 5, 40,
    ['My eye is glued shut and bright red.', 'Both eyes are gunky and sore.'],
    { hx: 'Toddler had the same thing.',
      // a topical antibiotic is the textbook move; a systemic one also works but
      // is second-line. Warm compresses + tears are curative supportive care.
      first: ['antibiotic-eye'], alt: ['antibiotic', 'antihistamine'],
      adj: ['ophthalmic-adjunct', 'ophthalmic', 'supportive'], supportiveDefinitive: true,
      dx: ['Conjunctivitis', 'Iritis', 'Corneal abrasion', 'Acute glaucoma'] }),

  P('constipation', 'Constipation', 5, 44,
    ['I have not been for a week and I am miserable.', 'Blocked up and bloated.'],
    { hx: 'New pain meds after surgery.', first: ['laxative'], alt: ['antispasmodic'],
      adj: ['fluid', 'supportive'], supportiveDefinitive: true,
      dx: ['Constipation', 'Bowel obstruction', 'Ileus', 'Colonic mass'] }),

  // ======================= common, moderate acuity =======================
  P('asthma', 'Asthma exacerbation', 2, 64,
    ['I cannot catch my breath and my inhaler is not touching it.', 'Wheezing badly since this morning.'],
    { hx: 'Asthmatic since childhood. Chest infection last week.',
      first: ['bronchodilator'], alt: ['corticosteroid'], adj: ['oxygen', 'bronchodilator-adjunct'],
      dx: ['Asthma exacerbation', 'COPD', 'Pneumonia', 'Anaphylaxis'],
      fail: 'resp', dispo: 'discharge', v: { rr: 26, spo2: 92, hr: 108 },
      contra: [{ med: 'metoprolol', effect: 'worse', note: 'A β-blocker in an asthmatic. The wheeze doubles.' }] }),

  P('copd', 'COPD exacerbation', 2, 50,
    ['Breathing is worse than usual and I am bringing up green stuff.', 'Cannot walk to the kitchen without stopping.'],
    { hx: '40 pack-years. Home oxygen.', first: ['bronchodilator', 'corticosteroid'],
      alt: ['antibiotic-resp', 'antibiotic'], adj: ['oxygen'],
      dx: ['COPD exacerbation', 'Pneumonia', 'Heart failure', 'PE'],
      fail: 'resp', dispo: 'medsurge', v: { rr: 24, spo2: 89, hr: 102 } }),

  P('pneumonia', 'Community-acquired pneumonia', 3, 58,
    ['Fever, cough, and it hurts to breathe in.', 'Coughing up rust-coloured gunk.'],
    { hx: 'Unwell for four days.', first: ['antibiotic-resp'], alt: ['antibiotic', 'antibiotic-broad'],
      adj: ['antipyretic', 'oxygen', 'fluid'],
      dx: ['Pneumonia', 'Bronchitis', 'PE', 'Heart failure'],
      fail: 'resp', dispo: 'medsurge', v: { temp: 38.6, rr: 22, spo2: 93, hr: 104 },
      img: { type: 'cxr_infiltrate', options: ['Right lower lobe consolidation', 'Normal', 'Pneumothorax', 'Pulmonary oedema'] } }),

  P('renal_colic', 'Renal colic', 3, 54,
    ['Worst pain of my life, in my side, and I cannot sit still.', 'Flank pain radiating to my groin.'],
    { hx: 'Had a stone years ago.', first: ['nsaid'], alt: ['analgesic-moderate', 'analgesic-severe'],
      adj: ['antiemetic', 'fluid', 'urologic'],
      dx: ['Renal colic', 'Pyelonephritis', 'AAA', 'Appendicitis'],
      v: { hr: 104, sbp: 146 }, labs: { UA: 'blood +++' } }),

  P('anxiety_insomnia', 'Acute anxiety with insomnia', 4, 66,
    ['I have not slept in three days and my heart will not slow down.', 'Panic attacks. I cannot switch my brain off.'],
    { hx: 'Recent job loss. No drugs, no alcohol.',
      // MANY reasonable routes: a benzo, a sedating antipsychotic, trazodone,
      // hydroxyzine, even propranolol for the somatic side
      first: ['anxiolytic'], alt: ['sedative-hypnotic', 'antipsychotic'], adj: ['anxiolytic-somatic', 'antidepressant'],
      dx: ['Anxiety with insomnia', 'Panic disorder', 'Hyperthyroidism', 'Stimulant use'],
      psych: true, v: { hr: 106, sbp: 138 }, tags: ['psych'] }),

  P('panic', 'Panic attack', 4, 48,
    ['I thought I was dying. Tingling hands, cannot breathe.', 'My chest went tight and I could not stop shaking.'],
    { hx: 'Happened twice before. Cardiology cleared me.',
      first: ['anxiolytic'], alt: ['anxiolytic-somatic', 'sedative-hypnotic'], adj: ['antidepressant'],
      dx: ['Panic attack', 'ACS', 'PE', 'Thyrotoxicosis'],
      psych: true, v: { hr: 116, rr: 24 }, tags: ['psych'] }),

  P('etoh_withdrawal', 'Alcohol withdrawal', 2, 46,
    ['I stopped drinking two days ago and I am shaking to bits.', 'Sweating, shaking, seeing things at the edges.'],
    { hx: 'A bottle of vodka a day. Last drink 48 hours ago.',
      first: ['withdrawal'], alt: ['benzodiazepine', 'anxiolytic'], adj: ['vitamin', 'fluid'],
      dx: ['Alcohol withdrawal', 'Delirium tremens', 'Sepsis', 'Encephalopathy'],
      fail: 'neuro', dispo: 'medsurge', agit: 0.004, psych: true,
      v: { hr: 118, sbp: 158, temp: 37.9 }, tags: ['psych'] }),

  P('opioid_od', 'Opioid overdose', 1, 42,
    ['*barely rousable, breathing four times a minute*'],
    { hx: 'Found down by a friend. Pinpoint pupils.',
      first: ['reversal-opioid'], alt: [], adj: ['oxygen'],
      dx: ['Opioid overdose', 'Benzodiazepine overdose', 'Stroke', 'Hypoglycaemia'],
      fail: 'resp', dispo: 'icu', agit: 0.02, psych: true,
      v: { rr: 6, spo2: 84, hr: 58 }, tags: ['psych', 'od'] }),

  P('paracetamol_od', 'Paracetamol overdose', 2, 30,
    ['I took a lot of pills last night. I regret it.', 'I swallowed a whole box. Hours ago.'],
    { hx: 'Deliberate. Around 20 tablets, 8 hours ago.',
      first: ['antidote'], alt: [], adj: ['decontamination', 'fluid'],
      dx: ['Paracetamol overdose', 'Salicylate overdose', 'Hepatitis', 'Gastritis'],
      fail: 'shock', dispo: 'medsurge', psych: true,
      labs: { 'Paracetamol level': '180 mg/L — above the line', ALT: '96' }, tags: ['psych', 'od'] }),

  P('suicidal', 'Suicidal ideation', 2, 38,
    ['I do not want to be here any more.', 'I have a plan and I am frightened of myself.'],
    { hx: 'Worsening over months. No attempt yet today.',
      first: ['psych-hold'], alt: ['anxiolytic', 'antipsychotic'], adj: ['sedative-hypnotic'],
      dx: ['Suicidal ideation', 'Major depression', 'Bipolar depression', 'Substance-induced'],
      dispo: 'medsurge', psych: true, tags: ['psych'] }),

  P('psychosis', 'Acute psychosis', 2, 32,
    ['They are broadcasting into my teeth. You know this.', '*talking rapidly to someone who is not there*'],
    { hx: 'Off medication for weeks, family says.',
      first: ['antipsychotic'], alt: ['agitation', 'benzodiazepine'], adj: ['mood-stabilizer'],
      dx: ['Acute psychosis', 'Mania', 'Delirium', 'Stimulant intoxication'],
      dispo: 'medsurge', agit: 0.006, psych: true, tags: ['psych'] }),

  P('syncope', 'Syncope', 3, 44,
    ['I passed out at the bus stop and woke up on the pavement.', 'Went grey and hit the deck.'],
    { hx: 'Stood up too fast. No chest pain.', first: ['fluid'], alt: ['electrolyte'], adj: ['oxygen'],
      dx: ['Vasovagal syncope', 'Arrhythmia', 'PE', 'GI bleed'],
      v: { hr: 92, sbp: 104 }, labs: { Hgb: '11.8', ECG: 'sinus rhythm' } }),

  P('afib_rvr', 'Atrial fibrillation with RVR', 2, 40,
    ['My heart is going like a washing machine.', 'Palpitations since this morning and I feel awful.'],
    { hx: 'Known AF. Missed my tablets.', first: ['rate-control'], alt: ['antiarrhythmic'],
      adj: ['anticoagulant', 'electrolyte'],
      dx: ['AF with RVR', 'SVT', 'Sinus tachycardia', 'Atrial flutter'],
      fail: 'cardiac', dispo: 'medsurge', v: { hr: 148, sbp: 108 } }),

  P('hypoglycemia', 'Hypoglycaemia', 2, 36,
    ['*sweaty, confused, cannot answer properly*'],
    { hx: 'Diabetic. Took insulin, skipped lunch.', first: ['glucose'], alt: [], adj: ['fluid'],
      dx: ['Hypoglycaemia', 'Stroke', 'Sepsis', 'Intoxication'],
      fail: 'neuro', v: { hr: 108, sbp: 132 }, labs: { Glucose: '2.1 mmol/L — LOW' } }),

  P('appendicitis', 'Appendicitis', 2, 34,
    ['Pain started round my belly button and moved to the right.', 'Right lower belly, worse when I cough.'],
    { hx: 'Off food since yesterday.', first: ['antibiotic-broad'], alt: ['antibiotic', 'anaerobic'],
      adj: ['analgesic-moderate', 'fluid', 'antiemetic'],
      dx: ['Appendicitis', 'Gastroenteritis', 'Ovarian cyst', 'Renal colic'],
      fail: 'shock', dispo: 'medsurge', surgery: 'appendectomy',
      v: { temp: 38.1, hr: 102 }, labs: { WBC: '16.4 HIGH' },
      img: { type: 'ct_appendicitis', options: ['Appendicitis with free fluid', 'Normal appendix', 'Diverticulitis', 'Ovarian torsion'] } }),

  // ======================= high acuity =======================
  P('anaphylaxis', 'Anaphylaxis', 1, 28,
    ['*face swelling, wheezing, covered in hives*'],
    { hx: 'Ate a takeaway with peanuts ten minutes ago.',
      first: ['anaphylaxis'], alt: [], adj: ['antihistamine', 'corticosteroid', 'bronchodilator', 'fluid'],
      dx: ['Anaphylaxis', 'Angio-oedema', 'Asthma', 'Panic attack'],
      fail: 'resp', dispo: 'medsurge', v: { sbp: 84, hr: 128, spo2: 90, rr: 28 } }),

  P('sepsis', 'Sepsis', 1, 30,
    ['*shivering, grey, barely with it*', 'I have been burning up and now I cannot stand.'],
    { hx: 'Cough for a week, then went downhill fast.',
      first: ['antibiotic-broad'], alt: ['antibiotic'], adj: ['fluid', 'vasopressor', 'oxygen'],
      dx: ['Sepsis', 'Influenza', 'PE', 'Heat stroke'],
      fail: 'shock', dispo: 'icu', v: { temp: 39.2, hr: 124, sbp: 86, rr: 26, spo2: 91 },
      labs: { Lactate: '4.8 HIGH', WBC: '19.2 HIGH' } }),

  P('stemi', 'STEMI', 1, 26,
    ['Elephant on my chest. Left arm is numb.', 'Crushing chest pain and I am sweating buckets.'],
    { hx: 'Smoker, hypertensive.', first: ['antiplatelet'], alt: [], adj: ['anticoagulant', 'antianginal', 'oxygen', 'analgesic-severe'],
      dx: ['STEMI', 'Unstable angina', 'Aortic dissection', 'Pericarditis'],
      fail: 'cardiac', dispo: 'icu', v: { hr: 104, sbp: 148 },
      labs: { Troponin: '4.2 RISING', ECG: 'ST elevation II/III/aVF' },
      contra: [{ med: 'tpa', effect: 'death', note: 'tPA here?! They needed the cath lab — massive bleed.' }] }),

  P('gi_bleed', 'Upper GI bleed', 1, 28,
    ['I threw up something that looked like coffee grounds.', 'Black tarry stools and I feel faint.'],
    { hx: 'NSAIDs daily for my knees.', first: ['blood-product'], alt: ['resuscitation'],
      adj: ['acid-suppression', 'somatostatin', 'fluid'],
      dx: ['Upper GI bleed', 'Gastritis', 'Varices', 'Mallory-Weiss tear'],
      fail: 'bleed', dispo: 'icu', v: { hr: 118, sbp: 94 },
      labs: { Hgb: '6.9 CRITICAL', BUN: '48' } }),

  P('dka', 'Diabetic ketoacidosis', 1, 24,
    ['I cannot stop being sick and my breath smells of pear drops.', 'Drinking litres, weeing constantly, exhausted.'],
    { hx: 'Type 1. Ran out of insulin days ago.',
      first: ['insulin'], alt: [], adj: ['fluid', 'electrolyte'],
      dx: ['DKA', 'Hyperosmolar state', 'Sepsis', 'Gastroenteritis'],
      fail: 'shock', dispo: 'icu', v: { hr: 122, sbp: 98, rr: 28 },
      labs: { Glucose: '31 mmol/L', pH: '7.08 ACIDOTIC', Ketones: '5.6' } }),

  P('stroke_isch', 'Ischaemic stroke', 1, 26,
    ['*right side has gone, speech is slurred*'],
    { hx: 'Symptoms started 90 minutes ago. On no blood thinners.',
      first: ['thrombolytic'], alt: [], adj: ['antiplatelet'],
      dx: ['Ischaemic stroke', 'Haemorrhagic stroke', 'Bell palsy', 'Hypoglycaemia'],
      fail: 'neuro', dispo: 'icu', v: { sbp: 172, hr: 88 },
      img: { type: 'ct_head_normal', options: ['No bleed — ischaemic', 'Intracranial haemorrhage', 'Tumour', 'Normal'] },
      tags: ['needs-ct'] }),

  P('sah', 'Subarachnoid haemorrhage', 1, 20,
    ['Thunderclap. Worst headache of my life, out of nowhere.', 'Like being hit in the back of the head.'],
    { hx: 'Sudden onset an hour ago while sitting down.',
      first: ['antihypertensive'], alt: [], adj: ['analgesic-severe', 'antiemetic'],
      dx: ['Subarachnoid haemorrhage', 'Ischaemic stroke', 'Migraine', 'Meningitis'],
      fail: 'neuro', dispo: 'icu', v: { sbp: 186, hr: 92 },
      img: { type: 'ct_head_bleed', options: ['Subarachnoid blood', 'No bleed', 'Ischaemic changes', 'Tumour'] },
      contra: [{ med: 'tpa', effect: 'death', note: 'tPA into a subarachnoid bleed. They never stood a chance.' }],
      tags: ['needs-ct'] }),

  P('pneumothorax', 'Tension pneumothorax', 1, 18,
    ['*one side of the chest is not moving, trachea pushed over*'],
    { hx: 'Tall, thin, sudden pain then could not breathe.',
      first: ['oxygen'], alt: [], adj: ['analgesic-severe'],
      dx: ['Tension pneumothorax', 'Asthma', 'PE', 'Pneumonia'],
      fail: 'resp', dispo: 'icu', surgery: 'chest_tube',
      v: { rr: 32, spo2: 84, hr: 128, sbp: 92 },
      img: { type: 'cxr_ptx', options: ['Large pneumothorax', 'Normal', 'Consolidation', 'Effusion'] } }),

  P('ectopic', 'Ruptured ectopic pregnancy', 1, 18,
    ['Sharp pain low on one side and I keep feeling faint.'],
    { hx: 'Last period seven weeks ago.',
      first: ['resuscitation'], alt: ['blood-product'], adj: ['fluid', 'analgesic-severe'],
      dx: ['Ruptured ectopic', 'Ovarian cyst', 'Appendicitis', 'UTI'],
      fail: 'bleed', dispo: 'ob', surgery: 'salpingectomy',
      v: { hr: 118, sbp: 92 }, labs: { 'β-hCG': 'POSITIVE 4,120', Hgb: '9.1 DROPPING' } }),

  P('meningitis', 'Bacterial meningitis', 1, 16,
    ['Headache, neck is rigid, and the light is agony.', '*febrile, photophobic, will not flex their neck*'],
    { hx: 'Unwell since this morning, deteriorating fast.',
      first: ['antibiotic-broad'], alt: ['antibiotic'], adj: ['corticosteroid', 'fluid', 'antipyretic'],
      dx: ['Bacterial meningitis', 'Viral meningitis', 'SAH', 'Migraine'],
      fail: 'neuro', dispo: 'icu', v: { temp: 39.4, hr: 118, sbp: 100 } }),

  P('hyperkalemia', 'Hyperkalaemia', 1, 16,
    ['I feel weak all over and my chest is fluttering.'],
    { hx: 'Dialysis patient, missed two sessions.',
      first: ['membrane-stabilizer'], alt: [], adj: ['insulin', 'glucose', 'alkalinizer'],
      dx: ['Hyperkalaemia', 'MI', 'Guillain-Barré', 'Hypokalaemia'],
      fail: 'cardiac', dispo: 'icu', v: { hr: 46, sbp: 104 },
      labs: { 'K+': '7.4 CRITICAL', ECG: 'peaked T waves, wide QRS' } }),

  P('status_epilepticus', 'Status epilepticus', 1, 14,
    ['*seizing on the trolley, has not stopped*'],
    { hx: 'Epileptic. Seizing for six minutes now.',
      first: ['anticonvulsant'], alt: ['benzodiazepine'], adj: ['oxygen', 'glucose'],
      dx: ['Status epilepticus', 'Hypoglycaemia', 'Eclampsia', 'Intracranial bleed'],
      fail: 'neuro', dispo: 'icu', v: { hr: 132, spo2: 88, temp: 38.2 } }),
];

// Weighted pick honouring the frequency column. `bias(p) → multiplier` lets a
// day skew the draw toward its acuity mix (quiet Tuesday vs. everything on fire).
export function pickPresentation(rng, bias) {
  const wOf = (p) => Math.max(0.0001, p.w * (bias ? bias(p) : 1));
  const total = PRESENTATIONS.reduce((s, p) => s + wOf(p), 0);
  let r = rng.next() * total;
  for (const p of PRESENTATIONS) { r -= wOf(p); if (r <= 0) return p; }
  return PRESENTATIONS[PRESENTATIONS.length - 1];
}

export const presentationById = (id) => PRESENTATIONS.find((p) => p.id === id);

// Plausible near-misses grouped by body system. A differential should be ten
// things that could genuinely explain the same complaint — not one right
// answer and three obviously-wrong ones.
export const DDX_POOL = {
  cardiac: ['Acute coronary syndrome', 'Unstable angina', 'Pericarditis', 'Myocarditis', 'Aortic dissection',
    'Atrial fibrillation', 'SVT', 'Heart failure', 'Cardiac tamponade', 'Costochondritis',
    'Hypertensive emergency', 'Takotsubo cardiomyopathy'],
  resp: ['Pneumonia', 'Asthma exacerbation', 'COPD exacerbation', 'Pulmonary embolism', 'Pneumothorax',
    'Bronchitis', 'Pleural effusion', 'Influenza', 'COVID-19', 'Pulmonary oedema', 'Croup', 'Foreign body aspiration'],
  gi: ['Appendicitis', 'Gastroenteritis', 'Cholecystitis', 'Pancreatitis', 'Diverticulitis', 'Bowel obstruction',
    'Peptic ulcer disease', 'GERD', 'Constipation', 'Mesenteric ischaemia', 'Hernia', 'Upper GI bleed',
    'Gastritis', 'Irritable bowel', 'C. difficile colitis'],
  neuro: ['Ischaemic stroke', 'Intracranial haemorrhage', 'Subarachnoid haemorrhage', 'Migraine',
    'Tension headache', 'Meningitis', 'Encephalitis', 'Seizure', 'Bell palsy', 'Vertigo',
    'Transient ischaemic attack', 'Temporal arteritis', 'Idiopathic intracranial hypertension'],
  gu: ['UTI / cystitis', 'Pyelonephritis', 'Renal colic', 'Testicular torsion', 'Ovarian torsion',
    'Ectopic pregnancy', 'Pelvic inflammatory disease', 'Urinary retention', 'Epididymitis', 'Ovarian cyst'],
  msk: ['Fracture', 'Sprain', 'Dislocation', 'Septic arthritis', 'Gout', 'Cellulitis', 'Tendon rupture',
    'Compartment syndrome', 'Mechanical back pain', 'Disc herniation', 'Cauda equina syndrome', 'Bursitis'],
  psych: ['Panic attack', 'Generalised anxiety', 'Major depression', 'Bipolar mania', 'Acute psychosis',
    'Alcohol withdrawal', 'Stimulant intoxication', 'Opioid withdrawal', 'Delirium', 'Somatic symptom disorder',
    'Insomnia disorder', 'Adjustment disorder'],
  tox: ['Opioid overdose', 'Benzodiazepine overdose', 'Paracetamol overdose', 'Salicylate overdose',
    'Alcohol intoxication', 'Sympathomimetic toxicity', 'Anticholinergic toxicity', 'Carbon monoxide poisoning',
    'Serotonin syndrome', 'Neuroleptic malignant syndrome', 'Tricyclic overdose'],
  endo: ['Diabetic ketoacidosis', 'Hypoglycaemia', 'Hyperosmolar hyperglycaemic state', 'Thyroid storm',
    'Myxoedema coma', 'Adrenal crisis', 'Hyperkalaemia', 'Hyponatraemia', 'Hypercalcaemia', 'Dehydration'],
  infect: ['Sepsis', 'Cellulitis', 'Abscess', 'Meningitis', 'Pneumonia', 'Pyelonephritis', 'Dental abscess',
    'Necrotising fasciitis', 'Endocarditis', 'Viral URI', 'Strep pharyngitis', 'Influenza'],
  derm: ['Urticaria', 'Contact dermatitis', 'Cellulitis', 'Shingles', 'Drug eruption', 'Stevens-Johnson syndrome',
    'Eczema', 'Scabies', 'Fungal infection', 'Angio-oedema'],
  eye: ['Conjunctivitis', 'Corneal abrasion', 'Iritis', 'Acute angle-closure glaucoma', 'Orbital cellulitis',
    'Retinal detachment', 'Subconjunctival haemorrhage', 'Blepharitis'],
};
