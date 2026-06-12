import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify — file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
  },
  build: {
    // Suppress the default 500KB warning — we're managing chunks explicitly
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── React core ────────────────────────────────────────────────
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router-dom/') ||
              id.includes('node_modules/scheduler/')) {
            return 'react-vendor';
          }

          // ── Tiptap editor (largest dependency) ───────────────────────
          if (id.includes('node_modules/@tiptap/') ||
              id.includes('node_modules/prosemirror-')) {
            return 'tiptap-vendor';
          }

          // ── UI utilities ─────────────────────────────────────────────
          if (id.includes('node_modules/lucide-react/') ||
              id.includes('node_modules/react-markdown/') ||
              id.includes('node_modules/remark') ||
              id.includes('node_modules/rehype') ||
              id.includes('node_modules/micromark') ||
              id.includes('node_modules/mdast') ||
              id.includes('node_modules/hast') ||
              id.includes('node_modules/unified') ||
              id.includes('node_modules/vfile') ||
              id.includes('node_modules/unist')) {
            return 'markdown-vendor';
          }
        },
      },
    },
  },
});
