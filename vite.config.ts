import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/notizbuch/',
  // Wann diese Version gebaut wurde: Die Einstellungen zeigen es, so sieht man am Gerät, ob die neue Version schon läuft.
  define: { __STAND__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    preact(),
    VitePWA({
      // Die App registriert den Service Worker selbst (src/lib/appUpdate.ts) und lädt eine neue Version im ruhigen Moment
      // neu. Der Service Worker übernimmt sofort (skipWaiting, clientsClaim), damit beim Übergang von Paket 2, das beim
      // Wechsel selbst neu lädt, einmal Neuladen genügt.
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: { skipWaiting: true, clientsClaim: true },
      manifest: {
        name: 'Notizbuch',
        short_name: 'Notizbuch',
        description: 'Notizbuch zum Schreiben mit dem Apple Pencil',
        lang: 'de',
        display: 'standalone',
        theme_color: '#44634c',
        background_color: '#f5f3ee',
        start_url: '/notizbuch/',
        scope: '/notizbuch/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
