import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
let errs = 0;
page.on('pageerror', (e) => { errs++; console.log('PAGEERROR:', e.message); });
await page.goto('file://' + process.argv[2] + '?lite=1');
try {
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 25000 });
  console.log('packed file boots OK, errors:', errs);
} catch { console.log('BOOT FAILED, errors:', errs); }
await browser.close();
