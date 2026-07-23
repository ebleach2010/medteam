import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  // one worker: two software-GL browsers starve each other and the walked
  // drag tests (wall-clock intervals vs a slowed sim) go flaky
  workers: 1,
  use: {
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    hasTouch: true,
    // use the environment's preinstalled Chromium when the pinned browser build is absent
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    port: 5199,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
