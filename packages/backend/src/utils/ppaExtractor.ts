import { logger } from './logger';

/**
 * Structured PPA metrics extracted from OpenROAD / OpenSTA log output.
 * All fields use SI units consistent with SKY130 PDK reporting.
 */
export interface PPAMetrics {
  /** Die area in µm² (from "Chip area for module" or "Design area" lines). */
  area: number;
  /** Total power in mW (from "Total" row in "Power Report"). */
  power: number;
  /** Target / achieved clock frequency in MHz, derived from WNS + period. */
  frequency: number;
  /** Worst Negative Slack in ns (negative = setup violation). */
  wns: number;
  /** Total Negative Slack in ns (negative = cumulative violation). */
  tns: number;
  /** Number of standard cells placed. */
  cells?: number;
  /** Number of nets. */
  nets?: number;
}

// ── Regex patterns ─────────────────────────────────────────────────────────────

// Area: "Chip area for module '\top': 123456.78"
//   or  "Design area 123456 u^2 23% utilization."
const AREA_RE_YOSYS    = /Chip area for (?:module|top)[^:]*:\s*([\d.]+)/i;
const AREA_RE_OPENROAD = /Design area\s+([\d.]+)\s+u\^2/i;

// Power: "Total\s+<val>\s+<val>\s+<val>\s+<total_mw>"
// OpenROAD power report column order: Internal  Switching  Leakage  Total
const POWER_RE = /^Total\s+[\d.e+-]+\s+[\d.e+-]+\s+[\d.e+-]+\s+([\d.e+-]+)/im;

// WNS / TNS from OpenSTA "report_checks" summary or OpenROAD integrated STA
// "wns -0.123"  or  "worst slack -0.123"
const WNS_RE = /(?:wns|worst\s+slack)\s*[:\s]?\s*(-?[\d.]+)/i;
// "tns -4.56"   or  "total negative slack -4.56"
const TNS_RE = /(?:tns|total\s+negative\s+slack)\s*[:\s]?\s*(-?[\d.]+)/i;

// Clock period from SDC or report: "clock period: 10.0" or "Period: 10"
const PERIOD_RE = /(?:clock\s+)?period\s*[:\s]\s*([\d.]+)/i;

// Cell count: "Number of cells: 4321"
const CELLS_RE = /(?:Number of cells|Num cells)\s*[:\s]\s*(\d+)/i;

// Net count: "Number of nets: 6789"
const NETS_RE = /(?:Number of nets|Num nets)\s*[:\s]\s*(\d+)/i;

// ── Extraction logic ───────────────────────────────────────────────────────────

function matchFloat(re: RegExp, text: string): number | null {
  const m = text.match(re);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) ? null : v;
}

/**
 * Extract PPA metrics from the combined stdout/stderr of an OpenROAD or
 * OpenSTA run.  Returns null if no recognisable metrics are found.
 */
export function extractPPAFromOpenROAD(log: string): PPAMetrics | null {
  if (!log || log.trim().length === 0) return null;

  const area =
    matchFloat(AREA_RE_OPENROAD, log) ??
    matchFloat(AREA_RE_YOSYS, log);

  // Power: OpenROAD reports in W by default; convert to mW.
  let power: number | null = matchFloat(POWER_RE, log);
  if (power !== null) power *= 1000; // W → mW

  const wns = matchFloat(WNS_RE, log) ?? 0;
  const tns = matchFloat(TNS_RE, log) ?? 0;

  // Derive frequency from period if available
  const period = matchFloat(PERIOD_RE, log);
  const frequency = period && period > 0 ? 1000 / period : 0; // MHz

  const cells = matchFloat(CELLS_RE, log) ?? undefined;
  const nets  = matchFloat(NETS_RE, log)  ?? undefined;

  if (area === null && power === null && wns === 0) {
    // Nothing recognisable found
    logger.debug('ppaExtractor: no metrics matched in log');
    return null;
  }

  const metrics: PPAMetrics = {
    area:      area  ?? 0,
    power:     power ?? 0,
    frequency: frequency,
    wns,
    tns,
    cells:     cells !== undefined ? Math.round(cells) : undefined,
    nets:      nets  !== undefined ? Math.round(nets)  : undefined,
  };

  logger.info('ppaExtractor: extracted metrics', metrics);
  return metrics;
}