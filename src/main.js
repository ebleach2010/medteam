import { initPhysics } from './physics/physics.js';
import { Game } from './Game.js';
import { installTestApi } from './debug/testApi.js';
import { preloadModels } from './render/models.js';

// stop touch drags from ever scrolling/bouncing the page (or an embedding host)
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest?.('#modal')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const params0 = new URLSearchParams(location.search);
// real 3D prop models load before the map builds; a miss falls back to the
// procedural mesh, so this can never block or break the boot
await preloadModels(params0.has('lite'));
const physics = await initPhysics();
// 🔑 key handoff: open the game as <url>#key=sk-ant-... once and the key is
// stored on this device (same slot the 🔑 board and MED-DOC use), then
// scrubbed from the address bar. Fragments are never sent to any server —
// this is how the key travels to new devices WITHOUT living in the repo.
{
  const m = /[#&?]key=([^&]+)/.exec(location.hash) ?? /[?&]key=([^&#]+)/.exec(location.search);
  if (m) {
    try { localStorage.setItem('medteam.anthropic_key', decodeURIComponent(m[1])); } catch { /* private mode */ }
    const url = new URL(location.href);
    url.searchParams.delete('key');
    url.hash = url.hash.replace(/[#&]key=[^&]*/, '');
    history.replaceState(null, '', url);
  }
}

const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('game'), physics, {
  seed: params.get('seed') ? +params.get('seed') : ((Math.random() * 0x7fffffff) | 0), // fresh shuffle every boot — no more ankle-sprain openers
  lite: params.has('lite'),
});
installTestApi(game);
game.start();
// we're up: drop the boot splash and clear the self-heal latch
document.getElementById('boot')?.classList.add('gone');
try { sessionStorage.removeItem('medteam.selfheal'); } catch { /* private mode */ }
