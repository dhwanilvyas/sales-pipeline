/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@mock-server': path.resolve(import.meta.dirname, './mock-server'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // One ~700 kB bundle (≈220 kB gzipped: React, Radix, the app) is fine for a single-screen app; no split needed.
  build: { chunkSizeWarningLimit: 800 },
  // Dev (npm run dev) and the production build (npm start) both open on the same URL: http://localhost:4173.
  // strictPort: if it's taken (e.g. both running at once), fail with a clear message instead of picking another port.
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: { environment: 'node' },
});
