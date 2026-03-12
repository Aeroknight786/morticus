import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
});

if (isWatch) {
  await ctx.watch();
  console.log('Watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
