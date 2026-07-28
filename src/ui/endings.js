// The last two screens anyone will ever see.
//
// showYouDied: ten seconds after the shotgun, the world fades slowly to black
// and asks "You Died. Try again?" — Y and N are the same door.
// showBSOD: behind that door is the classic blue screen. 20% complete,
// forever. Nothing is clickable. This is where the game ends.

export function showYouDied(game) {
  const fader = game.ui?.screens?.fader;
  if (fader) {
    fader.style.transition = 'opacity 3.2s ease';
    game.ui.screens.fade(true);
  }
  setTimeout(() => {
    if (document.getElementById('youdied') || document.getElementById('bsod')) return;
    const el = document.createElement('div');
    el.id = 'youdied';
    el.innerHTML = `
      <h1>You Died.</h1>
      <p>Try again?</p>
      <div class="ydrow"><button id="yd-y">Y</button><button id="yd-n">N</button></div>`;
    document.body.appendChild(el);
    const onward = () => { el.remove(); showBSOD(game); };
    el.querySelector('#yd-y').addEventListener('click', onward);
    el.querySelector('#yd-n').addEventListener('click', onward);
  }, 3400);
}

export function showBSOD(game) {
  if (document.getElementById('bsod')) return;
  game.paused = true;                     // nothing runs behind the blue
  const el = document.createElement('div');
  el.id = 'bsod';
  el.innerHTML = `
    <div class="b-inner">
      <div class="b-face">:(</div>
      <p class="b-msg">Your PC ran into a problem and needs to restart. We're just collecting some error info, and then we'll restart for you.</p>
      <p class="b-pct">20% complete</p>
      <div class="b-foot">
        <canvas class="b-qr" width="60" height="60"></canvas>
        <div class="b-notes">
          <p>For more information about this issue and possible fixes, visit https://www.windows.com/stopcode</p>
          <p>If you call a support person, give them this info:<br><br>Stop code: CRITICAL PROCESS DIED</p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  // a QR-looking block of noise — deterministic, and deliberately unscannable
  const ctx = el.querySelector('.b-qr').getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 60, 60);
  ctx.fillStyle = '#000';
  let seed = 41041;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) if (rnd() < 0.46) ctx.fillRect(3 + x * 2.16, 3 + y * 2.16, 2, 2);
  for (const [fx, fy] of [[3, 3], [42, 3], [3, 42]]) {   // the three finder squares
    ctx.fillRect(fx, fy, 15, 15);
    ctx.fillStyle = '#fff'; ctx.fillRect(fx + 2.5, fy + 2.5, 10, 10);
    ctx.fillStyle = '#000'; ctx.fillRect(fx + 5, fy + 5, 5, 5);
  }
}
