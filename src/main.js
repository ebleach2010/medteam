import { initPhysics } from './physics/physics.js';
import { Game } from './Game.js';
import { installTestApi } from './debug/testApi.js';

// stop touch drags from ever scrolling/bouncing the page (or an embedding host)
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest?.('#modal')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const physics = await initPhysics();
const seedParam = new URLSearchParams(location.search).get('seed');
const game = new Game(document.getElementById('game'), physics,
  { seed: seedParam ? +seedParam : 1337 });
installTestApi(game);
game.start();
