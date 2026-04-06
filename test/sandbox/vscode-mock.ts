/**
 * Lightweight VS Code API mock for sandbox testing.
 * Provides just enough of the vscode namespace to activate the extension
 * and exercise commands, tree views, webviews, and status bar.
 */

// Track all registered commands, tree providers, messages, and panels
export const registry = {
  commands: new Map<string, (...args: any[]) => any>(),
  treeProviders: new Map<string, any>(),
  messages: [] as { type: string; text: string }[],
  panels: [] as any[],
  statusBarItems: [] as any[],
  inputBoxResponses: [] as (string | undefined)[],
  quickPickResponses: [] as (any | undefined)[],
  contextValues: new Map<string, any>(),
  disposables: [] as any[],
};

export function reset() {
  registry.commands.clear();
  registry.treeProviders.clear();
  registry.messages.length = 0;
  registry.panels.length = 0;
  registry.statusBarItems.length = 0;
  registry.inputBoxResponses.length = 0;
  registry.quickPickResponses.length = 0;
  registry.contextValues.clear();
  registry.disposables.length = 0;
}

class MockUri {
  constructor(public fsPath: string) {}
  static file(path: string) { return new MockUri(path); }
  toString() { return this.fsPath; }
}

class MockTreeItem {
  label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: any;
  collapsibleState?: number;
  command?: any;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class MockThemeIcon {
  id: string;
  constructor(id: string) { this.id = id; }
}

class MockWebviewPanel {
  webview: any;
  visible = true;
  viewType: string;
  title: string;
  private messageHandlers: ((msg: any) => void)[] = [];
  private disposeHandlers: (() => void)[] = [];

  constructor(viewType: string, title: string) {
    this.viewType = viewType;
    this.title = title;
    this.webview = {
      html: '',
      options: { enableScripts: true },
      onDidReceiveMessage: (handler: (msg: any) => void) => {
        this.messageHandlers.push(handler);
        return { dispose: () => {} };
      },
      postMessage: (msg: any) => {
        // Record messages sent to webview
        registry.messages.push({ type: 'webview-message', text: JSON.stringify(msg) });
        return Promise.resolve(true);
      },
    };
    registry.panels.push(this);
  }

  // Simulate a message from the webview to the extension
  simulateMessage(msg: any) {
    for (const handler of this.messageHandlers) {
      handler(msg);
    }
  }

  get onDidDispose() {
    return (handler: () => void) => {
      this.disposeHandlers.push(handler);
      return { dispose: () => {} };
    };
  }

  reveal() {}
  dispose() {
    for (const handler of this.disposeHandlers) handler();
  }
}

class MockStatusBarItem {
  text = '';
  tooltip = '';
  command?: string;
  alignment: number;
  priority: number;
  visible = false;

  constructor(alignment: number, priority: number) {
    this.alignment = alignment;
    this.priority = priority;
    registry.statusBarItems.push(this);
  }

  show() { this.visible = true; }
  hide() { this.visible = false; }
  dispose() { this.visible = false; }
}

// Build the mock vscode module
export const vscode = {
  Uri: MockUri,
  TreeItem: MockTreeItem,
  ThemeIcon: MockThemeIcon,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ViewColumn: { One: 1, Two: 2, Three: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Notification: 15 },
  EventEmitter: class {
    private handlers: any[] = [];
    event = (handler: any) => { this.handlers.push(handler); return { dispose: () => {} }; };
    fire(data?: any) { for (const h of this.handlers) h(data); }
  },
  workspace: {
    workspaceFolders: [{ uri: new MockUri('/tmp/morticus-sandbox'), name: 'sandbox', index: 0 }],
  },
  window: {
    showInformationMessage: async (msg: string, ...actions: string[]) => {
      registry.messages.push({ type: 'info', text: msg });
      return undefined;
    },
    showWarningMessage: async (msg: string, ...args: any[]) => {
      registry.messages.push({ type: 'warning', text: msg });
      return undefined;
    },
    showErrorMessage: async (msg: string) => {
      registry.messages.push({ type: 'error', text: msg });
    },
    showInputBox: async (opts?: any) => {
      return registry.inputBoxResponses.shift();
    },
    showQuickPick: async (items: any[], opts?: any) => {
      const response = registry.quickPickResponses.shift();
      if (response === undefined) return undefined;
      if (typeof response === 'string') {
        return items.find((i: any) => i.label === response || i.value === response || i === response);
      }
      return response;
    },
    registerTreeDataProvider: (viewId: string, provider: any) => {
      registry.treeProviders.set(viewId, provider);
      return { dispose: () => {} };
    },
    createWebviewPanel: (viewType: string, title: string, column: any, options?: any) => {
      return new MockWebviewPanel(viewType, title);
    },
    createStatusBarItem: (alignment: number, priority: number) => {
      return new MockStatusBarItem(alignment, priority);
    },
    createTreeView: (viewId: string, options: any) => {
      return { dispose: () => {} };
    },
    withProgress: async (options: any, task: any) => {
      const progress = { report: () => {} };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
      };
      return task(progress, token);
    },
    tabGroups: { all: [{ tabs: [] }], activeTabGroup: { activeTab: null } },
  },
  commands: {
    registerCommand: (id: string, handler: (...args: any[]) => any) => {
      registry.commands.set(id, handler);
      return { dispose: () => {} };
    },
    executeCommand: async (id: string, ...args: any[]) => {
      if (id === 'setContext') {
        registry.contextValues.set(args[0], args[1]);
        return;
      }
      const handler = registry.commands.get(id);
      if (handler) {
        return handler(...args);
      }
    },
    getCommands: async () => Array.from(registry.commands.keys()),
  },
};
