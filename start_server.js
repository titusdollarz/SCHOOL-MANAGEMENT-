const { spawn } = require('child_process');
const path = require('path');

const nodePath = 'C:\\Program Files\\nodejs\\node.exe';

// Build a modified PATH that includes node's bin dir (for DLL dependencies)
const nodeBin = 'C:\\Program Files\\nodejs';
const serverDir = path.join(__dirname);

const server = spawn(nodePath, ['server.js'], { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });

let err = '';
server.stderr.on('data', (d) => { err += d; });
server.on('exit', (code) => { console.log('server exited', code, err.slice(0, 300)); });
server.on('error', (e) => { console.log('spawn error', e.message); });

setTimeout(() => {
  console.log('server spawned pid', server.pid);
  process.exit(0);
}, 1500);
