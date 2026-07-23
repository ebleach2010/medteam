// Verify: llm layer loads, falls back local without a key, settings modal opens.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://localhost:5199/?seed=7&lite=1');
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
// 1: settings board opens from the title
await page.locator('#screen .ai').dispatchEvent('pointerdown');
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/shots/llm-settings.png' });
const hasKeyBar = await page.locator('#keybar').count();
// 2: no key → askPatient falls back to the local matcher
await page.locator('#modal .close').dispatchEvent('pointerdown');
await page.evaluate(() => window.__game.start());
const out = await page.evaluate(async () => {
  const g = window.__game;
  const { askPatient, llmEnabled } = await import('/src/sim/llm.js');
  const id = g.spawnCase('ankle', -20, 8);
  const sim = [...g.game.world.byTag('patients')].find((p) => p.id === id).sim;
  return { enabled: llmEnabled(), ans: await askPatient(sim, 'Which ankle?') };
});
console.log(JSON.stringify({ hasKeyBar, ...out }));
await browser.close();
