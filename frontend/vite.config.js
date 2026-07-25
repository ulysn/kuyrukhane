import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'Family Library',
        short_name: 'Library',
        description: 'Manage your family book collection',
        theme_color: '#1a1a2e',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  build: {
    outDir: '../wwwroot',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/books':               'http://localhost:5254',
      '/register':            'http://localhost:5254',
      '/login':               'http://localhost:5254',
      '/logout':              'http://localhost:5254',
      '/me':                  'http://localhost:5254',
      '/forgot-password':     'http://localhost:5254',
      '/resend-verification': 'http://localhost:5254',
      '/verify-email':        'http://localhost:5254',
      '/reset-password':      'http://localhost:5254',
      '/users':               'http://localhost:5254',
      '/household':           'http://localhost:5254',
      '/health':              'http://localhost:5254',
    },
  },
})
