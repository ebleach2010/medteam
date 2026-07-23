# Single-player redesign spec (playtest direction, 2026-07)

The game is no longer two-player. You are THE DOCTOR; everyone else is
autonomous staff. Locked decisions from the design owner:

## Layout — compact, VERY recognizable, sectioned rooms
- TRIAGE/ADMISSION: reception desk + waiting chairs + knockable desk props
- PATIENT ROOMS 1–10: identical, numbered signs; bed + wall monitor + desk
  (clipboards land on the desk). Max 10 concurrent patients.
- LAB: centrifuge + bench (nurse-run)
- DIAGNOSTICS: ONE machine room; modality chosen from a list
- PHARMACY: med cabinet wall
- DISCHARGE room + gate + INCINERATOR pit (unchanged mechanic)

## Flow
Admission (assign room) → exam in room → orders → treat → stabilize → discharge.
Dispo tiers become MONITORING requirements (no ward transfer): discharge=0,
medsurge=60 game-min stable post-treatment, ob=90, icu=120. Chart + monitor
show STABLE ✓ when discharge-safe. Simple cases (tinea): treat → immediately
stable.

## Intake conversation (typed, free-form)
Chat modal on the patient: type ANY question; a local intent engine answers
from case data (onset, symptoms, history, meds, allergies, travel, drugs,
pain, family hx) in the patient's voice + quick chips. (True LLM chat needs a
hosted build — artifact sandbox has no network.)

## Typed diagnosis
Diagnosis is ENTERED AS TEXT; fuzzy matcher (normalized edit distance +
per-case synonyms) judges it. No more multiple choice.

## Autonomous staff (NPCs)
- NURSE: order labs → walks to room, draws, runs centrifuge, returns a
  CLIPBOARD onto the room's desk (interactable → labs report).
- TRANSPORTER: order imaging (pick modality: X-ray 15s, US 20s, CT 25s,
  MRI 60s, MRI+contrast 90s) → wheels patient to diagnostics; RAD TECH runs
  the machine; patient returned to their room; clipboard on desk → rise-up
  animation with the image + written report. Wrong modality = "no acute
  findings", time wasted.
- Staff visible/idling when unassigned.

## Angry patients
>5 real min unadmitted → upset: knock over triage props (physics). ~10 min →
may leave by temperament = LOST patient. TALK prompt opens chat; typed
de-escalation (apology / ETA / empathy intents) cools them; difficulty varies
by temperament stat.

## Feel/graphics
- Narrow FOV (≈42), close camera (keep)
- Dust poofs at feet while sprinting (tether poof system)
- Denser dressing: plants, posters, desk clutter, wall monitors
- Signs: ROOM 1..10, TRIAGE, LAB, DIAGNOSTICS, PHARMACY, DISCHARGE

## Status (phase 1 committed)
DONE: 10 numbered rooms w/ desks + wall monitors, sectioned zones (triage/
lab/diagnostics/pharmacy/discharge+pit), room signs, plants, compat wiring,
smoke+UI tests green.
IN PROGRESS: flows.spec lab-loop & OD tests failing on a dragTo hop after the
map change — debug the tow path hop by hop (suspect a wall segment or door
gap width along [-14.5,3.2]→[-14.5,-2] or the room-door pull).
NEXT (in order): typed intake chat · typed diagnosis (fuzzy) · stabilization
monitoring rule · nurse clipboard-to-desk labs loop · porter+tech imaging
pipeline w/ modality list+times · clipboard rise animation · angry
knockables/TALK de-escalation · lost-patient counter · dust poofs · FOV 42 ·
remove SWAP (single player).
