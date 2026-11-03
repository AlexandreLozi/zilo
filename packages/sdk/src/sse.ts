// Server-sent events framing (CONTRACT.md R-E2). One parser, fed decoded text in arbitrary pieces:
// the transport decodes bytes with a streaming `TextDecoder`, so a split can fall inside a
// multi-byte character, inside a CRLF pair, or inside any line. The parser handles comments,
// multi-line `data`, LF and CRLF, and never dispatches an incomplete frame at end of stream (the
// SSE rule: an event is delivered by the blank line that ends it).
import { ZiloProtocolError } from './errors.js';

export interface SseFrame {
  /** `id:` of the frame, when present (the job event's `seq` in this contract). */
  id: string | undefined;
  /** `event:` of the frame, when present (the job event's `type` in this contract). */
  event: string | undefined;
  /** The `data:` payload, multi-line values joined with `\n`. */
  data: string;
}

/** Bounds a malformed stream: one frame's buffered text never exceeds this. */
export const MAX_SSE_FRAME_BYTES = 1 << 20;

export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];
  private id: string | undefined;
  private eventName: string | undefined;

  /** Feeds decoded text; returns every frame completed by this piece. */
  push(text: string): SseFrame[] {
    if (text === '') return [];
    this.buffer += text;
    if (this.buffer.length > MAX_SSE_FRAME_BYTES) {
      throw new ZiloProtocolError('event stream: frame exceeds the bounded size');
    }
    const frames: SseFrame[] = [];
    let start = 0;
    for (;;) {
      const line = this.nextLine(start);
      if (line === undefined) break;
      start = line.next;
      this.line(line.text, frames);
    }
    this.buffer = this.buffer.slice(start);
    return frames;
  }

  /**
   * End of stream: an unterminated frame is discarded, as SSE requires. A frame already ended by
   * a blank line was dispatched by `push`.
   */
  end(): void {
    this.buffer = '';
    this.dataLines = [];
    this.id = undefined;
    this.eventName = undefined;
  }

  /** The next complete line, and where the text after it begins; `undefined` if incomplete. */
  private nextLine(from: number): { text: string; next: number } | undefined {
    for (let i = from; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch === '\n') return { text: this.buffer.slice(from, i), next: i + 1 };
      if (ch === '\r') {
        // A CR at the very end may be the first half of a CRLF split across two pieces: wait.
        if (i + 1 >= this.buffer.length) return undefined;
        const next = this.buffer[i + 1] === '\n' ? i + 2 : i + 1;
        return { text: this.buffer.slice(from, i), next };
      }
    }
    return undefined;
  }

  private line(text: string, frames: SseFrame[]): void {
    if (text === '') {
      if (this.dataLines.length > 0) {
        frames.push({ id: this.id, event: this.eventName, data: this.dataLines.join('\n') });
      }
      this.dataLines = [];
      this.id = undefined;
      this.eventName = undefined;
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'data':
        this.dataLines.push(value);
        break;
      case 'event':
        this.eventName = value;
        break;
      case 'id':
        if (!value.includes('\0')) this.id = value;
        break;
      // `retry` is the browser's reconnect hint; the SDK owns its own bounded backoff (R-E6).
      default:
        break;
    }
  }
}

/**
 * Byte-to-frame decoding (R-E2). `TextDecoder` in streaming mode keeps an incomplete multi-byte
 * character across pieces, so a chunk split can fall at any byte, including inside a character.
 */
export class SseDecoder {
  private readonly decoder = new TextDecoder('utf-8');
  private readonly parser = new SseParser();

  push(chunk: Uint8Array): SseFrame[] {
    return this.parser.push(this.decoder.decode(chunk, { stream: true }));
  }

  end(): void {
    // Flush a trailing incomplete character, then apply the end-of-stream rule.
    this.parser.push(this.decoder.decode());
    this.parser.end();
  }
}

/** Encodes one frame as the agent sends it (used by the contract mock and by tests). */
export function encodeSseFrame(frame: { id?: string; event?: string; data: string }): string {
  let out = '';
  if (frame.id !== undefined) out += `id: ${frame.id}\n`;
  if (frame.event !== undefined) out += `event: ${frame.event}\n`;
  for (const line of frame.data.split('\n')) out += `data: ${line}\n`;
  return `${out}\n`;
}
