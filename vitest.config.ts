import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/vscode-integration/**'],
    globals: true,
  },
  resolve: {
    alias: {
      vscode: './test/__mocks__/vscode.ts',
    },
  },
});
