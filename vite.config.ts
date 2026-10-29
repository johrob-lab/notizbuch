import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/notizbuch/',
  plugins: [
    preact(),
    VitePWA({
      // Neue Versionen werden automatisch geladen und aktiviert, ohne Rückfrage.
      // Registriert wird in src/main.tsx. injectRegister bleibt auf dem Standard "auto":
      // Nur dann setzt das Plugin bei autoUpdate skipWaiting und clientsClaim im Service Worker.
      registerType: 'autoUpdate',
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
