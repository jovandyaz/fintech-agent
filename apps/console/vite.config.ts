import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.CONSOLE_API_URL ?? 'http://localhost:3000';
const API_PREFIX = /^\/api/;

// In development Vite serves the console and forwards /api to the api, as
// nginx does in the container, so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  // default-src 'self' refuses data: URLs, so no font or image is inlined.
  build: { assetsInlineLimit: 0 },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        rewrite: (path) => path.replace(API_PREFIX, ''),
      },
    },
  },
});
