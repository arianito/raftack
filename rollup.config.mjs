import terser from '@rollup/plugin-terser';
import { globSync } from 'glob';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'rollup';

export default defineConfig({
  input: Object.fromEntries(
    globSync(path.resolve(process.cwd(), 'dist/**/*.js')).map((file) => [
      path.relative('dist', file.slice(0, file.length - path.extname(file).length)),
      fileURLToPath(new URL(file, import.meta.url)),
    ]),
  ),
  makeAbsoluteExternalsRelative: true,
  treeshake: true,
  output: [
    {
      dir: 'dist',
      format: 'esm',
      preserveModules: true,
      entryFileNames: '[name].mjs',
    },
    {
      dir: 'dist',
      format: 'cjs',
      preserveModules: true,
      entryFileNames: '[name].cjs',
    },
  ],
  plugins: [
    terser({
      format: {
        comments: false,
        beautify: true,
        ecma: '2022',
      },
      compress: false,
      mangle: false,
      module: false,
    }),
  ],
});
