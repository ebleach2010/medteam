import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // single-chunk output: the artifact build inlines everything into one HTML,
  // so dynamic-import chunks (the Anthropic SDK splits some) must be merged
  build: { target: 'es2022', rollupOptions: { output: { inlineDynamicImports: true } } },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,webmanifest,glb}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // a stale precache that points at a deleted bundle hash = white screen
        // on an installed PWA. Sweep old caches and take over immediately.
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'MedTeam — ED Chaos',
        short_name: 'MedTeam',
        description: 'Silly physics ED triage co-op: triage, treat, and try not to kill anyone.',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#0e1420',
        theme_color: '#0e1420',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
});
