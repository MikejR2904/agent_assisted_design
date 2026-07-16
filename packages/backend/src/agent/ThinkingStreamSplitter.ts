const OPEN_TAG = '<thinking>';
const CLOSE_TAG = '</thinking>';

// Longest tag we watch for, minus one — how many trailing characters we must hold back on each
// push() in case a tag is split across two provider stream chunks (e.g. one chunk ends "...<thi"
// and the next starts "nking>...").
const MAX_HOLDBACK = Math.max(OPEN_TAG.length, CLOSE_TAG.length) - 1;

type Mode = 'answer' | 'thinking';

// Splits a raw token stream into "answer" and "thinking" channels based on a prompted
// <thinking>...</thinking> block, without assuming tag boundaries align with chunk boundaries.
// Purely a presentation-layer router — the caller is responsible for keeping the original,
// untouched text (with tags) for anything that needs the literal response (conversation history,
// tool-call parsing).
export class ThinkingStreamSplitter {
  private buffer = '';
  private mode: Mode = 'answer';

  constructor(
    private readonly onAnswerToken: (token: string) => void,
    private readonly onReasoningToken: (token: string) => void,
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;

    // Repeatedly consume as many complete mode-transitions as the buffer currently contains.
    for (;;) {
      const tag = this.mode === 'answer' ? OPEN_TAG : CLOSE_TAG;
      const idx = this.buffer.indexOf(tag);
      if (idx === -1) break;

      const before = this.buffer.slice(0, idx);
      if (before) this.emit(before);
      this.buffer = this.buffer.slice(idx + tag.length);
      this.mode = this.mode === 'answer' ? 'thinking' : 'answer';
    }

    // No (more) complete tag in the buffer — emit everything except a trailing holdback window,
    // so a tag split across this push() and the next one doesn't get emitted as partial text.
    if (this.buffer.length > MAX_HOLDBACK) {
      const safeLength = this.buffer.length - MAX_HOLDBACK;
      this.emit(this.buffer.slice(0, safeLength));
      this.buffer = this.buffer.slice(safeLength);
    }
  }

  // Call once the underlying stream has ended — flushes whatever's left in the holdback buffer.
  flush(): void {
    if (this.buffer) {
      this.emit(this.buffer);
      this.buffer = '';
    }
  }

  private emit(text: string): void {
    if (this.mode === 'answer') this.onAnswerToken(text);
    else this.onReasoningToken(text);
  }
}
