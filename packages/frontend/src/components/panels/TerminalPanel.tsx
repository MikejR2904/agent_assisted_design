'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { Eraser } from 'lucide-react';
import 'xterm/css/xterm.css';

interface TerminalPanelProps {
  sessionId: string; // used to identify terminal session
  onClose?: () => void;
}

// Matches packages/frontend/tailwind.config.js's `surface`/`accent`/`success`/`warning`/`error`
// palette, rather than the ad-hoc hex values this file used to hardcode independently.
const XTERM_THEME = {
  background: '#0f1117',   // surface.DEFAULT
  foreground: '#d4d4d4',
  cursor: '#4f8ef7',        // accent.DEFAULT
  cursorAccent: '#0f1117',
  selectionBackground: '#1e3a6a', // accent.muted
  black: '#0f1117',
  red: '#ef4444',           // error
  green: '#22c55e',         // success
  yellow: '#f59e0b',        // warning
  blue: '#4f8ef7',          // accent.DEFAULT
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#d4d4d4',
  brightBlack: '#4b5563',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#6ba3ff',    // accent.hover
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#f9fafb',
};

interface ContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

export function TerminalPanel({ sessionId, onClose }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [, setSocket] = useState<WebSocket | null>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Track mounting state to prevent server/client hydration mismatch
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !terminalRef.current) return;
    let isDestroyed = false;

    // Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      theme: XTERM_THEME,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      rows: 30,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(terminalRef.current);
    // safer initial fit
    setTimeout(() => {
      if (
        !isDestroyed &&
        terminalRef.current?.offsetWidth &&
        terminalRef.current?.offsetHeight &&
        (term as any)._core?.viewport // ensure viewport exists
      ) {
        try {
          fit.fit();
        } catch (err) {
          console.debug('Initial fit skipped:', err);
        }
      }
    }, 0);

    terminalInstance.current = term;
    fitAddon.current = fit;

    // Connect to WebSocket terminal backend
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const wsUrl = `ws://${hostname}:5000/terminal?sessionId=${sessionId}`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      if (!isDestroyed) term.writeln('Connected to terminal session.');
    };
    ws.onmessage = (event) => {
      if (!isDestroyed) term.write(event.data);
    };
    ws.onerror = () => {
      if (!isDestroyed) term.writeln(`\r\n[Error] Terminal connection error.`);
    };
    ws.onclose = () => {
      if (!isDestroyed) term.writeln('\r\n[Disconnected] Terminal session closed.');
    };
    setSocket(ws);

    // Handle user input
    const dataListener = term.onData((data) => {
      if (!isDestroyed && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    let resizeAnimationFrameId: number;
    const resizeObserver = new ResizeObserver((entries) => {
      if (isDestroyed || !entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width <= 0 || height <= 0) return;

      cancelAnimationFrame(resizeAnimationFrameId);
      resizeAnimationFrameId = requestAnimationFrame(() => {
        try {
          if (
            !isDestroyed &&
            terminalInstance.current &&
            terminalInstance.current.element // ensure DOM attached
          ) {
            fitAddon.current?.fit();
          }
        } catch (err) {
          console.debug("xterm fit skipped:", err);
        }
      });
    });
    resizeObserver.observe(terminalRef.current!);

    // Cleanup
    return () => {
      isDestroyed = true;
      cancelAnimationFrame(resizeAnimationFrameId);
      resizeObserver.disconnect();
      dataListener.dispose();
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (terminalRef.current) {
        terminalRef.current.innerHTML = '';
      }
      try {
        fit.dispose();
        links.dispose();
      } catch (e) {
        console.debug('Addon disposal skipped:', e);
      }
      try {
        term.dispose();
      } catch (e) {
        console.debug('Error during xterm instance disposal:', e);
      }
      terminalInstance.current = null;
      fitAddon.current = null;
    };
  }, [sessionId]);

  const handleClear = () => {
    terminalInstance.current?.clear();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hasSelection = !!terminalInstance.current?.hasSelection();
    setContextMenu({ x: e.clientX, y: e.clientY, hasSelection });
  };

  const handleCopy = async () => {
    const selection = terminalInstance.current?.getSelection();
    if (selection) {
      try {
        await navigator.clipboard.writeText(selection);
      } catch (err) {
        console.debug('Clipboard write failed:', err);
      }
    }
    setContextMenu(null);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      terminalInstance.current?.paste(text);
    } catch (err) {
      console.debug('Clipboard read failed:', err);
    }
    setContextMenu(null);
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-raised border-b border-surface-overlay">
        <span className="text-xs font-mono text-gray-400">Terminal</span>
        <div className="flex items-center gap-3">
          <button
            onClick={handleClear}
            title="Clear terminal"
            className="text-gray-500 hover:text-accent transition-colors"
          >
            <Eraser size={13} />
          </button>
          {onClose && (
            <button onClick={onClose} title="Close terminal" className="text-gray-500 hover:text-white text-xs">
              ✕
            </button>
          )}
        </div>
      </div>
      <div ref={terminalRef} className="flex-1 overflow-hidden" onContextMenu={handleContextMenu} />

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-surface-elevated border border-surface-overlay rounded shadow-xl py-1 min-w-[120px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={handleCopy}
              disabled={!contextMenu.hasSelection}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-gray-300 hover:bg-surface-overlay disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              Copy
            </button>
            <button
              onClick={handlePaste}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-gray-300 hover:bg-surface-overlay transition-colors"
            >
              Paste
            </button>
          </div>
        </>
      )}
    </div>
  );
}
