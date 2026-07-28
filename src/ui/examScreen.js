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
  const drift = iv(() => {
    for (const p of pupils) {
      p.style.transform = `translate(${Math.round(Math.random() * 16 - 8)}px, ${Math.round(Math.random() * 12 - 6)}px)`;
    }
  }, 1100);

  // ...until the machine starts shaking, at which point they become actual
  // googly eyes: pupils bouncing around inside the sockets, off the walls.
  const shakeEyes = (on) => {
    if (!on) return;
    clearInterval(drift);
    for (const p of pupils) p.style.transition = 'none';
    const R = 13;                                          // how far a pupil can travel before it hits the rim
    const st = pupils.map(() => ({ x: 0, y: 0, vx: (Math.random() * 2 - 1) * 3.6, vy: (Math.random() * 2 - 1) * 3.6 }));
    iv(() => {
      for (let i = 0; i < pupils.length; i++) {
        const s = st[i];
        s.vx += (Math.random() * 2 - 1) * 1.5;             // the shaking keeps kicking them
        s.vy += (Math.random() * 2 - 1) * 1.5 + 0.5;       // and gravity has opinions
        s.x += s.vx; s.y += s.vy;
        const d = Math.hypot(s.x, s.y);
        if (d > R) {                                       // bounce off the inside of the eye
          const nx = s.x / d, ny = s.y / d;
          s.x = nx * R; s.y = ny * R;
          const dot = s.vx * nx + s.vy * ny;
          s.vx = (s.vx - 2 * dot * nx) * 0.72;
          s.vy = (s.vy - 2 * dot * ny) * 0.72;
        }
        s.vx *= 0.94; s.vy *= 0.94;
        pupils[i].style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      }
    }, 33);
  };

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
  // a slider you actually SLIDE: press anywhere on the track and drag, and the
  // value tracks your finger until you let go. (A native range input inside a
  // page that eats touchmove only ever registered taps.)
  const slider = (min, max, buttonLabel) => new Promise((res) => {
    const row = line('inrow');
    const s = document.createElement('input');
    s.type = 'range'; s.min = min; s.max = max; s.step = 1; s.value = Math.round((min + max) / 2);
    const val = document.createElement('div');
    val.className = 'slval'; val.textContent = s.value;
    const show = () => { val.textContent = s.value; game.audio?.click?.(); };
    s.addEventListener('input', show);
    // drive the value straight from the pointer position so a hold-and-drag
    // works even where the browser's own thumb tracking is being suppressed
    const setFromX = (clientX) => {
      const r = s.getBoundingClientRect();
      if (!r.width) return;
      const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const v = Math.round(min + f * (max - min));
      if (String(v) !== s.value) { s.value = String(v); show(); }
    };
    s.addEventListener('pointerdown', (e) => {
      s.setPointerCapture?.(e.pointerId);       // the finger keeps the slider even if it wanders off
      setFromX(e.clientX);
    });
    s.addEventListener('pointermove', (e) => {
      if (e.buttons === 0 && e.pointerType === 'mouse') return;
      if (!s.hasPointerCapture?.(e.pointerId)) return;
      e.preventDefault();
      setFromX(e.clientX);
    });
    s.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) { e.preventDefault(); setFromX(t.clientX); }
    }, { passive: false });
    const go = document.createElement('button');
    go.textContent = buttonLabel;
    go.addEventListener('click', () => { if (done) return; game.audio?.tap?.(); const v = +s.value; row.remove(); res(v); });
    row.appendChild(val); row.appendChild(s); row.appendChild(go);
  });

  // a lettered multiple-choice block: each option is its own wide, tappable row
  const choices = (opts) => new Promise((res) => {
    const wrap = line('mcq');
    for (const [letter, text] of opts) {
      const b = document.createElement('button');
      b.className = 'mcqopt';
      b.innerHTML = `<span class="mcql">${letter}</span><span class="mcqt">${esc(text)}</span>`;
      b.addEventListener('click', () => { if (done) return; game.audio?.tap?.(); wrap.remove(); res(letter); });
      wrap.appendChild(b);
    }
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
    // and suddenly, without warning, a real board question. Immaculately
    // written. Genuinely answerable. It does not matter in the slightest.
    clear();
    await say('QUESTION SIX:', 'hdr', 20);
    await say('A 34-year-old woman presents with recurrent episodes of muscle weakness that are worse after exercise. She also reports intermittent palpitations and nephrolithiasis. Blood pressure is 168/96 mmHg.', 'q', 9);
    if (done) return;
    await say('Laboratory studies:\n  Sodium: 143 mEq/L\n  Potassium: 2.6 mEq/L\n  Chloride: 96 mEq/L\n  Bicarbonate: 35 mEq/L\n  Creatinine: Normal\n  Plasma renin activity: Suppressed\n  Plasma aldosterone: Elevated', 'labs', 7);
    if (done) return;
    await say('CT imaging reveals a 1.8-cm unilateral adrenal nodule.\n\nWhich of the following is the mechanism most directly responsible for this patient’s metabolic alkalosis?', 'q', 9);
    if (done) return;
    await choices([
      ['A', 'Increased hydrogen ion secretion by α-intercalated cells secondary to mineralocorticoid receptor activati'],
      ['B', 'Increased bicarbonate reabsorption caused by proximal tubular carbonic anhydrase overexpression'],
      ['C', 'Decreased chloride delivery to the distal nephron leading to impaired pendrin activity'],
      ['D', 'Increased ammoniagenesis caused primarily by chronic hypokalemia, independent of aldosterone'],
    ]);
    if (done) return;
    // whichever they picked. It was never being graded.
    clear();
    el.classList.add('quake');                            // the whole machine starts shaking
    shakeEyes(true);                                      // and the googly pupils rattle loose
    game.audio?.alarm?.();
    const verdict = line('verdict');
    verdict.textContent = 'If you’re confident enough to answer that question you should be confident enough to handle this';
    await sleep(3000);
    finish();
  })();
}
