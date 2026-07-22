import { initPhysics } from './physics/physics.js';
import { Game } from './Game.js';
import { installTestApi } from './debug/testApi.js';

const physics = await initPhysics();
const seedParam = new URLSearchParams(location.search).get('seed');
const game = new Game(document.getElementById('game'), physics,
  { seed: seedParam ? +seedParam : 1337 });
installTestApi(game);
game.start();
