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
        // Precache the hashed STATIC assets (immutable — safe to cache-first),
        // but NOT index.html: a precached index that points at a deleted bundle
        // hash is exactly what strands an installed PWA on the loading screen.
        globPatterns: ['**/*.{js,css,wasm,png,webmanifest,glb}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // drop the default precache navigation route (it would serve a stale/
        // missing precached index and shadow the network-first route below)
        navigateFallback: null,
        // The document is NETWORK-FIRST: an online player always gets the
        // current index.html (and therefore the current asset hashes), so a new
        // deploy can never serve them a stale shell. Offline falls back to the
        // last good copy, so the installed app still opens with no connection.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'medteam-html',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4 },
            },
          },
        ],
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
