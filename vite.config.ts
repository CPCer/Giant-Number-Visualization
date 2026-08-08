import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves the site under /Giant-Number-Visualization/,
  // so built assets must be prefixed with that path. Dev server keeps '/'.
  base: command === 'build' ? '/Giant-Number-Visualization/' : '/',
  server: {
    port: 5173,
    host: true,
  },
}));
