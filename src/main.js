import { initPhysics } from './physics/physics.js';
import { Game } from './Game.js';
import { installTestApi } from './debug/testApi.js';

// stop touch drags from ever scrolling/bouncing the page (or an embedding host)
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest?.('#modal')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const physics = await initPhysics();
const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('game'), physics, {
  seed: params.get('seed') ? +params.get('seed') : 1337,
  lite: params.has('lite'),
});
installTestApi(game);
game.start();
