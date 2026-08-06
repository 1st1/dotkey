import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point at the sources so the demo hot-reloads library edits without a build.
      '@dotkey/core/node': resolve('../../packages/core/src/node.ts'),
      '@dotkey/core/fonts': resolve('../../packages/core/src/fonts/index.ts'),
      '@dotkey/core': resolve('../../packages/core/src/index.ts'),
      '@dotkey/react': resolve('../../packages/react/src/index.ts'),
    },
  },
  server: { port: 5273, fs: { allow: ['../..'] } },
});
