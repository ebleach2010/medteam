// 👀 THE A-DUMB COMPUTER — IQ BOARDS EXAM.
//
// The ED is shut down by order of the Board until the attending passes this
// exam. The exam cannot be passed: every answer is wrong on purpose, the
// numbering is broken, and the ten-minute timer is theatre. Question six (or
// the timer running out — whichever comes first) powers the CRT down onto ten
// simultaneously crashing patients. That is the game now.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function showBoardsExam(game, onDone) {
  const el = document.createElement('div');
  el.id = 'adumb';
  el.innerHTML = `
    <div class="crt-eyes"><span class="ceye"><b></b></span><span class="ceye"><b></b></span></div>
    <div class="crt-timer" id="adtimer"></div>
    <div class="crt-body" id="adbody"></div>
    <div class="crt-scan"></div>`;
  document.body.appendChild(el);
  const body = el.querySelector('#adbody');
  const timerEl = el.querySelector('#adtimer');

  let done = false;
  const ivs = [];
  const iv = (fn, ms) => { const t = setInterval(fn, ms); ivs.push(t); return t; };
  const destroy = () => { done = true; ivs.forEach(clearInterval); el.remove(); if (game._exam?.el === el) game._exam = null; };
  const finish = () => {
    if (done) return;
    done = true;
    ivs.forEach(clearInterval);
    el.classList.add('off');                    // CRT collapses to a bright line
    game.audio?.reject?.();
    setTimeout(() => { el.remove(); if (game._exam?.el === el) game._exam = null; onDone(); }, 950);
  };
  game._exam = { el, destroy, finish };

  // the googly pupils drift this way and that, never settling
  const pupils = [...el.querySelectorAll('.ceye b')];
  iv(() => {
    for (const p of pupils) {
      p.style.transform = `translate(${Math.round(Math.random() * 16 - 8)}px, ${Math.round(Math.random() * 12 - 6)}px)`;
    }
  }, 1100);

  // ten minutes on the wall. Zero → straight into the disaster, mid-word if
  // need be.
  let timeLeft = null;
  const startTimer = () => {
    timeLeft = 10 * 60;
    const paint = () => {
      const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
      timerEl.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
      timerEl.classList.toggle('low', timeLeft <= 60);
    };
    paint();
    iv(() => {
      if (done) return;
      timeLeft -= 1;
      paint();
      if (timeLeft <= 0) finish();
    }, 1000);
  };

  // ---- tiny CRT toolkit ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // paced by wall-clock, not tick count — a starved main thread catches up in
  // one repaint instead of typing at a glacier's pace
  const typeInto = (target, text, speed = 16) => new Promise((res) => {
    const t0 = performance.now();
    let shown = 0;
    const t = setInterval(() => {
      if (done) { clearInterval(t); res(); return; }
      const i = Math.min(text.length, Math.floor((performance.now() - t0) / speed) + 1);
      if (i !== shown) {
        shown = i;
        target.innerHTML = esc(text.slice(0, i)).replace(/\n/g, '<br>') + '<span class="cur">▮</span>';
        if (i % 3 === 0 && text[i - 1] !== ' ') game.audio?.type?.();
      }
      if (i >= text.length) { clearInterval(t); target.innerHTML = esc(text).replace(/\n/g, '<br>'); res(); }
    }, 24);
    ivs.push(t);
  });
  const line = (cls = '') => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    body.appendChild(d);
    d.scrollIntoView?.({ block: 'end' });
    return d;
  };
  const say = async (text, cls = 'resp', speed = 16) => { await typeInto(line(cls), text, speed); };
  const clear = () => { body.innerHTML = ''; };
  const buttons = (labels) => new Promise((res) => {
    const row = line('btnrow');
    for (const label of labels) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => { if (done) return; game.audio?.tap?.(); row.remove(); res(label); });
      row.appendChild(b);
    }
  });
  const textInput = (placeholder = 'TYPE YOUR ANSWER') => new Promise((res) => {
    const row = line('inrow');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.placeholder = placeholder;
    const go = document.createElement('button');
    go.textContent = '⏎';
    const submit = () => {
      if (done) return;
      const v = inp.value.trim();
      if (!v) return;
      game.audio?.tap?.();
      const shown = line('you'); shown.textContent = '> ' + v;
      row.remove();
      res(v);
    };
    go.addEventListener('click', submit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    row.appendChild(inp); row.appendChild(go);
    setTimeout(() => inp.focus(), 60);
  });
  const slider = (min, max, buttonLabel) => new Promise((res) => {
    const row = line('inrow');
    const s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = 1; s.value = Math.round((min + max) / 2);
    const val = document.createElement('div');
    val.className = 'slval'; val.textContent = s.value;
    s.addEventListener('input', () => { val.textContent = s.value; game.audio?.click?.(); });
    const go = document.createElement('button');
    go.textContent = buttonLabel;
    go.addEventListener('click', () => { if (done) return; game.audio?.tap?.(); const v = +s.value; row.remove(); res(v); });
    row.appendChild(val); row.appendChild(s); row.appendChild(go);
  });

  // ---- the exam itself ----
  (async () => {
    await say('MEDTEAM GENERAL — NOTICE OF CLOSURE', 'hdr', 22);
    await sleep(300);
    await say('THE EMERGENCY DEPARTMENT IS SHUT DOWN.\n\nBy order of the Board, no shift may begin until the attending on duty passes the A-DUMB COMPUTER IQ BOARDS EXAM.', 'note', 14);
    if (done) return;
    const exe = line('');
    const b = document.createElement('button');
    b.className = 'exe';
    b.textContent = '▓ TAKE BORED EXAM.EXE ▓';
    exe.appendChild(b);
    await new Promise((res) => b.addEventListener('click', () => { game.audio?.boot?.(); res(); }));
    if (done) return;
    startTimer();

    // ---------- QUESTION 1 ----------
    clear();
    await say('QUESTION 1:\n\nWhich weighs more:\n\nA) a kilogram of steel\nB) a kilogram of feathers\nC) enter your own answer', 'q');
    const q1 = await buttons(['A', 'B', 'C']);
    if (done) return;
    if (q1 === 'C') {
      const t = (await textInput()).toLowerCase();
      if (done) return;
      if (t.includes('neither')) await say('Wrong answer. Correct answer: both');
      else if (t.includes('both')) await say('Wrong answer, neither.');
      else await say('Wrong answer. Correct answer: both');
    } else {
      await say('Wring answer. Correct answer: C, choose your own answer.');
    }
    if (done) return;
    await say('Would you like to try the question again?');
    await buttons(['Y', 'N']);
    if (done) return;
    await say('There’s no time. Next question..');
    await sleep(8000);   // the wrong answer hangs there. you sit with it.

    // ---------- QUESTION 2 ----------
    clear();
    await say('QUESTION 2:\n\nHow would you rate your emotional intelligence on a scale from one to ten?', 'q');
    await slider(1, 10, 'LVL ON YOUR ANSWER');
    if (done) return;
    await say('Incorrect answer. Emotional intelligence lies on the z axis because it requires depth.');
    await sleep(500);
    await say('this isn’t looking good');
    await sleep(8000);

    // ---------- QUESTION 3 ----------
    clear();
    await say('QUESTION 3:\n\nWhat rhymes with door hinge (slant rhyme allowed)?', 'q');
    await textInput();
    if (done) return;
    await say('Wrong answer, that was not the slant rhyme I was looking for');
    await sleep(8000);

    // ---------- QUESTION 4 ----------
    clear();
    await say('QUESTION 4:\n\nWhat’s the best tool to unclog a toilet?', 'q');
    await textInput();
    if (done) return;
    await say('ha, clever but no points for being clever');
    await sleep(8000);

    // ---------- QUESTION 4 (the computer is confident this is fine) ----------
    clear();
    await say('QUESTION 4:\n\nHow many points do you get for being clever in this exam?', 'q');
    const q4b = await slider(0, 10, 'LVL ON YOUR ANSWER');
    if (done) return;
    if (q4b === 0) await say('Correct; you get 0 points. No points awarded for that correct answer.');
    else await say('Wrong answer: 0 points. How did you get your medical license?');
    await sleep(8000);

    // ---------- QUESTION 5 ----------
    clear();
    await say('QUESTION 5:\n\nHow old are you?', 'q');
    await textInput();
    if (done) return;
    await say('Wrong answer. Correct answer: ‘this many’');
    await sleep(8000);

    // ---------- QUESTION SIX ----------
    clear();
    await say('QUESTION SIX:\n\nWhat series of numbers represents the devil or dark magic?', 'q');
    await textInput();
    if (done) return;
    game.audio?.alarm?.();
    await say('IDK AIF THAT WAS RIGHT OR NOT BUT TEN PATIENTS STARTED CRASHING AS YOU TOOK THAT TEST WTF ARE YOU DOING', 'wtf', 24);
    await sleep(1400);
    finish();
  })();
}
