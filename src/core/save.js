const KEY = 'medteam-save-v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw); if (s.version === 1) return s; }
  } catch { /* corrupted or unavailable — start fresh */ }
  return { version: 1, highestDay: 1, totalTreated: 0, totalDeaths: 0, bestDayScore: 0 };
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode etc. */ }
}
