// Minimal vscode mock for tests that transitively import vscode via llm-provider.ts

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
  }),
};
