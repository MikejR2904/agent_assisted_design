/**
 * Error classifier for EDA tool output.
 *
 * Categorises tool stderr/stdout into one of four types so the Reflexion
 * loop and the upstream agent can apply the most appropriate retry strategy:
 *
 *  SYNTAX    – Verilator parse / elaboration errors; Yosys syntax issues.
 *              Fix: regenerate the RTL or TCL with corrected syntax.
 *
 *  FUNCTIONAL – Testbench assertion failures; simulation mismatches.
 *              Fix: review logic, not just syntax.
 *
 *  PHYSICAL  – OpenROAD / OpenSTA timing violations, DRC / LVS errors,
 *              floorplan / routing failures.
 *              Fix: adjust constraints, floorplan parameters, or macro placement.
 *
 *  UNKNOWN   – Anything else (permissions, missing files, network, etc.).
 *              Fix: surface to human; default retry.
 */

export enum ErrorType {
  SYNTAX     = 'SYNTAX',
  FUNCTIONAL = 'FUNCTIONAL',
  PHYSICAL   = 'PHYSICAL',
  UNKNOWN    = 'UNKNOWN',
}

// ── Pattern tables ─────────────────────────────────────────────────────────────

const SYNTAX_PATTERNS: RegExp[] = [
  /syntax error/i,
  /parse error/i,
  /unexpected token/i,
  /undeclared identifier/i,
  /elaboration error/i,
  /module not found/i,
  /port not found/i,
  /%error:/i,                       // Verilator %Error:
  /\[error\].*syntax/i,
  /cannot be declared/i,
  /undefined variable/i,
  /illegal use of/i,
];

const FUNCTIONAL_PATTERNS: RegExp[] = [
  /assertion failed/i,
  /assert\s*\(/i,
  /mismatch/i,
  /testbench.*fail/i,
  /test.*fail/i,
  /simulation.*error/i,
  /expected.*got/i,
  /wrong output/i,
  /check failed/i,
  /verilator.*warning.*always/i,    // Verilator latch warnings often signal logic bugs
];

const PHYSICAL_PATTERNS: RegExp[] = [
  /timing violation/i,
  /wns.*-/i,                        // Negative WNS
  /tns.*-/i,                        // Negative TNS
  /setup.*violation/i,
  /hold.*violation/i,
  /drc.*violation/i,
  /lvs.*error/i,
  /placement.*failed/i,
  /routing.*failed/i,
  /cannot meet timing/i,
  /openroad.*error/i,
  /opensta.*error/i,
  /floorplan.*error/i,
  /congestion/i,
  /overflow/i,                      // Routing overflow
];

// ── Classifier ─────────────────────────────────────────────────────────────────

/**
 * Classify a tool error log string into one of the four ErrorType categories.
 *
 * @param log  Combined stdout + stderr from the failing tool execution.
 * @returns    The most specific ErrorType that matches, or UNKNOWN.
 */
export function classifyError(log: string): ErrorType {
  if (!log || log.trim().length === 0) return ErrorType.UNKNOWN;

  // Physical errors are checked first because OpenROAD output can also
  // contain generic "error" tokens that would otherwise match SYNTAX.
  if (PHYSICAL_PATTERNS.some((re) => re.test(log))) return ErrorType.PHYSICAL;
  if (SYNTAX_PATTERNS.some((re) => re.test(log)))   return ErrorType.SYNTAX;
  if (FUNCTIONAL_PATTERNS.some((re) => re.test(log))) return ErrorType.FUNCTIONAL;

  return ErrorType.UNKNOWN;
}

/**
 * Return a human-readable guidance string for the agent based on error type.
 * Used to enrich the reflexion prompt so the model knows what kind of fix
 * to attempt next.
 */
export function errorGuidance(type: ErrorType): string {
  switch (type) {
    case ErrorType.SYNTAX:
      return 'This is a SYNTAX error. Check port declarations, module instantiations, and keyword usage. Do not change the design intent — only fix the syntax.';
    case ErrorType.FUNCTIONAL:
      return 'This is a FUNCTIONAL error. The RTL compiles but produces incorrect behaviour. Review the logic, data-path computations, and FSM transitions.';
    case ErrorType.PHYSICAL:
      return 'This is a PHYSICAL DESIGN error. Timing closure or DRC violations detected. Consider relaxing the clock period, adjusting placement density, or modifying SDC constraints.';
    case ErrorType.UNKNOWN:
    default:
      return 'The error type could not be classified. Check file paths, tool availability, and environment variables before retrying.';
  }
}