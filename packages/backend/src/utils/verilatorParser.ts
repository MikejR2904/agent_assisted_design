import { logger } from './logger';

export interface VerilatorDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code?: string;
  message: string;
}

// Verilator diagnostic lines look like:
//   %Error: file.v:12:5: message text
//   %Warning-WIDTH: file.v:8:1: message text
//   %Error-UNSUPPORTED: file.v:3: message text (no column)
const DIAG_RE = /^%(Error|Warning)(-[A-Z0-9_]+)?:\s*[^:]+:(\d+):(?:(\d+):)?\s*(.*)$/gm;

/** Parses the combined stdout/stderr of a `verilator --lint-only` run into structured
 * diagnostics. Returns an empty array (not null) when nothing is recognisable — mirrors
 * ppaExtractor.ts's graceful-degradation style but an empty list is itself a valid "clean" result. */
export function parseVerilatorOutput(log: string): VerilatorDiagnostic[] {
  if (!log || log.trim().length === 0) return [];

  const diagnostics: VerilatorDiagnostic[] = [];
  let match: RegExpExecArray | null;
  DIAG_RE.lastIndex = 0;
  while ((match = DIAG_RE.exec(log)) !== null) {
    const [, severityRaw, codeRaw, lineRaw, columnRaw, message] = match;
    diagnostics.push({
      line: parseInt(lineRaw, 10),
      column: columnRaw ? parseInt(columnRaw, 10) : 1,
      severity: severityRaw.toLowerCase() === 'error' ? 'error' : 'warning',
      code: codeRaw ? codeRaw.slice(1) : undefined,
      message: message.trim(),
    });
  }

  logger.debug('verilatorParser: parsed diagnostics', { count: diagnostics.length });
  return diagnostics;
}
