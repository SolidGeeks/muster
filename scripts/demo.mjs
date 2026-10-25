// SPDX-License-Identifier: AGPL-3.0-or-later
// Starts Muster in demo mode with data in ./data-demo (works on Windows, macOS and Linux).
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server.js'], {
  stdio: 'inherit', env: { DATA_DIR: './data-demo', PORT: '8080', ...process.env, DEMO_MODE: 'true' }
});
child.on('exit', code => process.exit(code ?? 0));
