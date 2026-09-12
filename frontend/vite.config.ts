import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
      '/socket.io': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
