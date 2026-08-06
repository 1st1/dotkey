import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/node.ts', fonts: 'src/fonts/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: ['es2021', 'node18'],
  // The generated protobuf descriptor is imported as JSON and inlined so the
  // published package is self-contained.
  loader: { '.json': 'json' },
  // Node builtins stay external — only `./node` touches them, and the browser
  // entry must never pull them in. esbuild emits them without the `node:`
  // prefix regardless of target, which resolves the same in Node.
  external: [/^node:/],
});
