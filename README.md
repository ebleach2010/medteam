# MedTeam — ED Chaos 🏥

A silly top-down 3D physics game about running an emergency department. Think
*Human: Fall Flat* meets *Overcooked*, in a hospital where everything is real
medicine and everyone is wobbly.

You control a **nurse** and a **doctor** (tap 🔄 to swap; online co-op is the
roadmap — every action already flows through a serializable intent layer).
Patients pour into the waiting room with complaints in fading speech bubbles,
from athlete's foot to subarachnoid hemorrhage. You have to:

- **Triage** and drag/escort them to ED beds (doorways are exactly one flailing
  patient wide)
- **Communicate silently** with the hold-to-open radial wheel (🩸 labs, 📷
  imaging, 💊 meds, 💉 sedate…)
- **Work them up**: hook the monitor for live vitals, draw blood, carry the
  vial to the lab, spin the centrifuge (20 real seconds, no you can't rush it),
  hand the printout to the doctor
- **Interpret imaging yourself** — procedurally generated X-rays/CTs, and yes,
  giving tPA to the bleed you didn't scan is exactly as lethal as it should be
- **Raid the pharmacy** shelves for anything from antifungal cream to IVIG —
  wrong meds have real consequences (β-blockers in asthma, aminoglycosides in
  myasthenia…)
- **Tackle** agitated patients who rip out their IVs and sprint away, sedate
  them, and drag them back to bed
- **Admit** to ICU / Med-Surge / Birthplace when the case calls for it

Each in-game day (starting 12:00 AM, heavily accelerated) is a level. Day 1 is
a gentle trickle of tier-1 sniffles; by day 5 you're getting guaranteed
stroke pairs and the waiting room is red-faced and cursing (`✱#@%!`). Patients
die from neglect, deterioration, and your pharmacological mistakes. Treat as
many as you can.

## Tech

- **Three.js** rendering, procedural primitive art, tilted top-down camera
- **Rapier** (WASM) physics — wobbly upright-spring characters, spring-joint
  carrying/dragging, physics tackles
- **Vite + PWA**: installable on a phone, landscape, dual-thumb touch controls
  (virtual joystick + context action button), works offline
- 21-case medical content library (`src/data/cases.js`) with vitals timelines,
  labs, imaging findings, contraindications, and deterioration→death arcs
- No server, no accounts; progress in `localStorage`

## Develop

```bash
npm install
npm run dev          # → http://localhost:5173, WASD works on desktop
npm run build        # static PWA in dist/
npm test             # Playwright end-to-end (set PW_CHROMIUM_PATH if needed)
```

Tests drive the game through the same intent pipe as touch input via
`window.__game` (see `src/debug/testApi.js`) — which doubles as a harness for
the future networked co-op.

## Disclaimer

This is a *game*. The medicine is real-ish for comedy and consequence, but
nothing here is medical advice, obviously. Please do not centrifuge your
friends.
