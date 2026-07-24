import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto('http://localhost:5199/?seed=7&lite=1');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
await page.evaluate(() => window.__game.start());
const out = await page.evaluate(async () => {
  const g = window.__game;
  const { answerQuestion } = await import('/src/sim/talk.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mk = (caseId) => { const id = g.spawnCase(caseId, -20, 8); return [...g.game.world.byTag('patients')].find((p) => p.id === id).sim; };
  await sleep(200);
  const ankle = mk('ankle'), appy = mk('appy'), stemi = mk('stemi');
  return {
    ankle_which: answerQuestion(ankle, 'Which ankle?'),
    ankle_when: answerQuestion(ankle, 'When did it start?'),
    ankle_probe: answerQuestion(ankle, 'Tell me about the ankle'),
    appy_where: answerQuestion(appy, 'Where does it hurt?'),
    appy_meds: answerQuestion(appy, 'Are you taking any medications?'),
    stemi_family: answerQuestion(stemi, 'Any family history?'),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
