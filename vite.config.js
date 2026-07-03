import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Phase 10 — manual chunk splitting.
         *
         * Before: one 1,646 kB bundle.
         * After:  vendor chunks loaded in parallel; initial JS payload is smaller
         *         because the chart library and trading engine are split out.
         *
         * Chunk strategy:
         *   vendor-react        – React + React-DOM (stable, long cache TTL)
         *   vendor-lwc          – lightweight-charts (large, rarely changes)
         *   engine              – trading / replay / chart engine classes
         *   indicators          – Pine / indicator subsystem
         *   app                 – everything else (components, stores, feeds)
         */
        manualChunks(id) {
          // ── React runtime ─────────────────────────────────────────────
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }

          // ── Lightweight Charts library ─────────────────────────────────
          if (id.includes('node_modules/lightweight-charts')) {
            return 'vendor-lwc';
          }

          // ── Trading / replay / chart engine (pure JS, no React) ────────
          if (
            id.includes('/src/engine/') ||
            id.includes('/src/core/') ||
            id.includes('/src/feeds/') ||
            id.includes('/src/utils/')
          ) {
            return 'engine';
          }

          // ── Indicators subsystem ───────────────────────────────────────
          if (id.includes('/src/indicators/') || id.includes('pine-ts')) {
            return 'indicators';
          }

          // ── Zustand (store runtime) ────────────────────────────────────
          if (id.includes('node_modules/zustand')) {
            return 'vendor-zustand';
          }

          // Everything else (components, stores, App) goes in the default chunk.
        },
      },
    },
  },
})
