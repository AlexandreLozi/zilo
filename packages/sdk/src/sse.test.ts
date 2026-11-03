// R-E2: SSE framing must survive a chunk split at any byte, CRLF and LF, comments, multi-line
// `data` and a multi-byte character divided between two chunks.
import { describe, expect, it } from 'vitest';
import { encodeSseFrame, SseDecoder, SseParser, type SseFrame } from './sse.js';

const frames: SseFrame[] = [
  { id: '1', event: 'state', data: '{"seq":1,"type":"state","state":"queued"}' },
  { id: '2', event: 'page', data: '{"seq":2,"type":"page","page":{"index":0}}' },
];

function streamText(): string {
  return [
    ': hb\n\n',
    encodeSseFrame({ ...(frames[0] as SseFrame), data: `${frames[0]?.data ?? ''}` }),
    ': another comment\n\n',
    encodeSseFrame({
      id: '2',
      event: 'page',
      data: '{"seq":2,\n"type":"page",\n"note":"héllo 😀"}',
    }),
    '\n',
  ].join('');
}

describe('T21a SSE parser', () => {
  it('parses frames with comments, multi-line data and LF or CRLF', () => {
    const parser = new SseParser();
    const out = [
      ...parser.push('id: 1\r\nevent: state\r\ndata: {"a":1}\r\n\r\n'),
      ...parser.push('id: 2\n'),
      ...parser.push('event: page\n'),
      ...parser.push('data: {"b":\ndata: 2}\n\n'),
    ];
    parser.end();
    expect(out).toEqual([
      { id: '1', event: 'state', data: '{"a":1}' },
      { id: '2', event: 'page', data: '{"b":\n2}' },
    ]);
  });

  it('waits for a CRLF split between its two characters', () => {
    const parser = new SseParser();
    expect(parser.push('id: 1\r')).toEqual([]);
    expect(parser.push('\ndata: x\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([{ id: '1', event: undefined, data: 'x' }]);
  });

  it('discards an unterminated frame at end of stream', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1}')).toEqual([]);
    parser.end();
    expect(parser.push('\n\n')).toEqual([]);
  });

  it('produces the same frames for a split at every byte boundary', () => {
    const text = streamText();
    const whole = new SseDecoder();
    const expected = [...whole.push(new TextEncoder().encode(text))];
    whole.end();
    expect(expected).toHaveLength(2);
    expect(expected[1]?.data).toContain('héllo 😀');

    const bytes = new TextEncoder().encode(text);
    for (let split = 0; split <= bytes.byteLength; split++) {
      const decoder = new SseDecoder();
      const out = [
        ...decoder.push(bytes.subarray(0, split)),
        ...decoder.push(bytes.subarray(split)),
      ];
      decoder.end();
      expect(out, `split at byte ${String(split)}`).toEqual(expected);
    }
  });

  it('produces the same frames for every two-byte window', () => {
    const bytes = new TextEncoder().encode(streamText());
    const decoder = new SseDecoder();
    const out: SseFrame[] = [];
    for (let i = 0; i < bytes.byteLength; i += 2)
      out.push(...decoder.push(bytes.subarray(i, Math.min(bytes.byteLength, i + 2))));
    decoder.end();
    expect(out.map((f) => f.id)).toEqual(['1', '2']);
    expect(out[1]?.data).toContain('😀');
  });

  it('ignores unknown fields and keeps an empty data line', () => {
    const parser = new SseParser();
    const out = parser.push('retry: 1000\nfoo: bar\ndata\ndata: \n\n');
    expect(out).toEqual([{ id: undefined, event: undefined, data: '\n' }]);
  });
});
