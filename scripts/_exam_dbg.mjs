import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await p.goto('http://localhost:5199/?seed=9&lite=1');
await p.waitForFunction(() => window.__game?.ready, null, { timeout: 20000 });
for (const t of [2000, 4000, 8000]) {
  await p.waitForTimeout(t === 2000 ? 2000 : t - (t === 4000 ? 2000 : 4000));
  const html = await p.evaluate(() => document.querySelector('#adumb .crt-body')?.innerHTML?.slice(-260) ?? 'NO BODY');
  console.log(`--- t=${t}:`, html.replace(/\n/g, ' '));
}
await b.close();
