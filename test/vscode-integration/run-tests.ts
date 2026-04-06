/**
 * VS Code integration test runner.
 * Downloads a real VS Code instance, opens a test workspace, and exercises the
 * Morticus extension end-to-end inside xvfb.
 */
import * as path from 'path';
import * as fs from 'fs';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // Create a disposable workspace for the test
    const testWorkspace = path.resolve(__dirname, '..', '..', 'test-workspace');
    if (!fs.existsSync(testWorkspace)) {
      fs.mkdirSync(testWorkspace, { recursive: true });
    }

    // Initialize a minimal git repo so worktree features don't break
    const { execSync } = require('child_process');
    if (!fs.existsSync(path.join(testWorkspace, '.git'))) {
      execSync('git init', { cwd: testWorkspace, stdio: 'ignore' });
      execSync('git -c user.email="test@test.com" -c user.name="Test" commit --allow-empty -m "init"', { cwd: testWorkspace, stdio: 'ignore' });
    }

    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

    console.log('Extension path:', extensionDevelopmentPath);
    console.log('Test suite path:', extensionTestsPath);
    console.log('Test workspace:', testWorkspace);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        '--disable-extensions',  // disable other extensions
        '--disable-gpu',
      ],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
