'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

interface TerminalPanelProps {
  sessionId: string; // used to identify terminal session
  onClose?: () => void;
}

export function TerminalPanel({ sessionId, onClose }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [, setSocket] = useState<WebSocket | null>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

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
      theme: {
        background: '#0f1117',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      rows: 30,
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

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-raised border-b border-surface-overlay">
        <span className="text-xs font-mono text-gray-400">Terminal</span>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xs">
            ✕
          </button>
        )}
      </div>
      <div ref={terminalRef} className="flex-1 overflow-hidden" />
    </div>
  );
}