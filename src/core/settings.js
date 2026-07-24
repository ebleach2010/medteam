// Player preferences: audio, control modes, custom keybinds. One versioned
// localStorage blob, loaded once at boot and shared by everything.
const KEY = 'medteam.settings.v1';

export const DEFAULT_KEYS = {
  grab: 'KeyE', action: 'KeyF', wheel: 'KeyR', swap: 'KeyQ', tackle: 'KeyT', pager: 'KeyP',
};

export const settings = {
  vol: 1,            // 0..1 master volume
  muted: false,
  wheelMode: 'toggle', // 'toggle' | 'hold' — how the ORDERS wheel key behaves
  grabMode: 'toggle',  // 'toggle' | 'hold' — how the grab key behaves
  keys: { ...DEFAULT_KEYS },
};

try {
  const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  Object.assign(settings, stored);
  settings.keys = { ...DEFAULT_KEYS, ...(stored.keys ?? {}) };
} catch { /* fresh defaults */ }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

// 'KeyE' → 'E', 'Digit1' → '1', 'Space' → '␣', anything else verbatim
export const keyLabel = (code) =>
  code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Space$/, '␣');
