import { defineConfig } from 'vite';

export default defineConfig({
  // Phaser is about 1.2 MB on its own, so raise the warning limit.
  build: { chunkSizeWarningLimit: 2000, target: 'es2022' },
});
