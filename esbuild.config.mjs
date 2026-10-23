import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const hostConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20', // VS Code 1.100 and later run Node 20 or newer
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const webviewConfig = {
  entryPoints: ['src/webview/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  sourcemap: !production,
  minify: production,
  loader: { '.css': 'text' },
  logLevel: 'info',
};

if (watch) {
  const hostCtx = await esbuild.context(hostConfig);
  const webviewCtx = await esbuild.context(webviewConfig);
  await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
  console.log('esbuild watching...');
} else {
  await Promise.all([esbuild.build(hostConfig), esbuild.build(webviewConfig)]);
}
