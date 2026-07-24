// Clinical equivalence: what ELSE counts as a right answer.
//
// The game used to demand the exact med id, so ordering IV fluids for a
// dehydrated patient did nothing because the case happened to list oral
// rehydration. That's backwards. Keyed by the med a case asks for; the listed
// ids are defensible substitutes FOR THAT INDICATION.
//
// Deliberately absent — the specific/definitive therapies where getting the
// exact agent IS the puzzle: tpa, naloxone, epi, digifab, fomepizole,
// hydroxocobalamin, flumazenil, antitoxin, artesunate, ivig, pyridostigmine,
// hemin, octreotide, calcium, insulin, prbc, oxygen, magnesium, levothyroxine,
// charcoal, acyclovir, permethrin, antifungal, colchicine, thiamine, bicarb.
export const ACCEPTS = {
  // ---- volume ----
  // IV fluids are an equal-or-better answer anywhere oral rehydration is asked
  // for (not the reverse: you can't drink your way out of septic shock).
  ors: ['fluids'],

  // ---- analgesia / antipyresis ----
  nsaid: ['aspirin'],
  morphine: ['ketamine'],          // severe pain: opioid or dissociative

  // ---- sedation / agitation ----
  sedative: ['benzo', 'ketamine', 'haloperidol'],
  benzo: ['sedative'],
  haloperidol: ['sedative', 'benzo'],

  // ---- glycemic rescue ----
  d50: ['glucagon'],
  glucagon: ['d50'],

  // ---- antibiotics ----
  // for the common bacterial presentations any sensible agent counts; this is
  // the biggest quality-of-life win (no more guess-the-exact-antibiotic)
  amoxicillin: ['azithromycin', 'doxycycline', 'ceftriaxone'],
  nitrofurantoin: ['ceftriaxone', 'amoxicillin', 'gentamicin'],
  ceftriaxone: ['vancomycin', 'azithromycin', 'amoxicillin', 'gentamicin'],
  azithromycin: ['doxycycline', 'ceftriaxone', 'amoxicillin'],
  doxycycline: ['azithromycin', 'ceftriaxone'],
  vancomycin: ['ceftriaxone'],
  metronidazole: ['ceftriaxone'],
};

// does `given` satisfy a case's requirement for `needed`?
export const satisfies = (needed, given) =>
  needed === given || (ACCEPTS[needed] ?? []).includes(given);

// has every requirement been met by something in the given set?
export const regimenComplete = (needed, givenSet) =>
  needed.every((m) => [...givenSet].some((g) => satisfies(m, g)));
