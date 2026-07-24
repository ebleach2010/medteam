# Design notes — research digests

Two deep dives commissioned 2026-07 to reground the interaction model. Digest
below; keep these rules in mind for every new mechanic.

## Human: Fall Flat mechanics (verified against decompiled source)

- **Grab is hold-to-hold, contact-driven.** Hands are "armed" while the button
  is held; touching something grabbable within reach welds the hand to it
  (locked joint, high break force). Releasing the button destroys the joint
  the same frame. No toggle, no context prompt.
- **One verb covers everything.** Levers, doors, props, other players — all
  grabbable by default (explicit opt-out). Puzzles emerge from universal
  rules, not scripted interactions. UI prompts don't exist; affordance is
  shape + invisible grab-magnetism + hands visibly sticking.
- **Forces are two-way.** Every hand force gets an equal-opposite reaction
  routed into the body — that's how climbing works (pull on a welded hand →
  hoist the body) and why dragging heavy things staggers you.
- **Heavy vs light is emergent**: a fixed force budget means light items carry
  and heavy items drag. Per-object multipliers tune feel.
- **Wobble rule**: weak springs + strong damping + capped forces; failures are
  slow collapses, never jitter; the camera never inherits body rotation, so
  control survives every fall.
- MedTeam mapping: GRAB button = sticky hands while held (`Character.grabHeld`),
  spring-carry with reaction impulses (`springToward` returns the impulse),
  upright-spring tilt wobble, faceplant = temporarily weakened spring.

## Medical-sim design patterns (Two Point / Project Hospital / Surgeon Sim / Ambulance Life / The Stretchers)

- **One canonical pipeline, always visible**: arrival → triage → bed hub →
  diagnostics branch → treatment → explicit discharge. Never auto-despawn a
  resolved patient — closing the loop is the compulsion engine.
- **Queue pressure is spatial**: bodies stacking in the waiting room ARE the
  pressure UI; add per-patient urgency color (green→red) so you know *who's
  next*, not just *how many*.
- **Diagnosis = evidence pruning** (Project Hospital): symptoms observed →
  candidate list → each test reveals hidden evidence → confirm. Tests are
  physical fetch-and-read loops with delay (the co-op scheduler).
- **Wrong treatment punishes with time, not fail-state**: new visible symptom
  + faster deterioration + reopened case.
- **Rooms are machines with one input and one output** (patient in → film
  out). Physical tokens (vial, film, chart) are the pipeline state.
- **Comedy placement rule** (Surgeon Sim → HFF calibration): floppy physics
  for transport and handoffs, generous snap zones for the medical act itself.
- **Failure is softened**: death = a physical shame-task (sheet + gurney out)
  plus score, never instant game-over; shift ends judge you.
- MedTeam mapping: stations react to what arrives (bed auto-hooks monitor,
  centrifuge eats vials, scanner scans whoever parks on it, meds administer
  by holding them at the bedside); urgency dots + drop-target rings; wrong
  meds accelerate timelines with a bubble tell.

## Backlog seeded by the research

- Triage wristband tagging as the nurse's first physical verb (Ambulance Life)
- Palpation exam: poke a body part, patient yelps → localizes the problem
- Two-person verbs: CPR (one compresses, one bags), stretcher lifts
- Chart as a physical object; discharge = stamp it at the exit desk
- Death shame-task: wheel the sheeted gurney out yourself
- Stability mini-loop for reds: pressure/oxygen/fluids pause deterioration
  without curing
- One novel wrinkle per day instead of flat scaling (bus-crash day, lookalike
  pair day — the stroke pair already does this)
