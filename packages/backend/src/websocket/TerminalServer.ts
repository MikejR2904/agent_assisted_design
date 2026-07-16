import { WebSocketServer as WSS } from 'ws';
import http from 'http';
import { spawn } from 'node-pty'; 
import path from 'path';
import os from 'os';
import fs from 'fs';
import { ConfigManager } from '../config/ConfigManager';

export function createTerminalServer(server: http.Server) {
  const wss = new WSS({ server, path: '/terminal' });

  wss.on('connection', (ws, req) => {
    const sessionId = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('sessionId');
    if (!sessionId) {
      ws.close(1008, 'sessionId required');
      return;
    }

    // Spawn a shell (bash)
    let shell: string;
    if (os.platform() === "win32") { // Windows: use cmd.exe or powershell.exe
      shell = process.env.ComSpec || "cmd.exe";
    } else { // Unix-like: use SHELL or fallback to bash
      shell = process.env.SHELL || "/bin/bash";
    }

    const workspaceRoot = ConfigManager.getInstance().get().paths.workspaceRoot ?? './workspaces';
    const targetCwd = path.resolve(workspaceRoot, `condition_agent-assisted`);
    // Ensure the target directory actually exists recursively
    if (!fs.existsSync(targetCwd)) {
      fs.mkdirSync(targetCwd, { recursive: true });
    }

    const pty = spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: targetCwd, // or per session
      env: process.env,
    });

    pty.onData((data) => {
      ws.send(data);
    });

    ws.on('message', (message) => {
      pty.write(message.toString());
    });

    ws.on('close', () => {
      pty.kill();
    });
  });
}