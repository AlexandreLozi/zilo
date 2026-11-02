/// <reference types="node" />
// PLAN §8 SDK detection budgets: raw numbers only, no gating until T56a. Against the in-process
// contract mock these measure SDK overhead, not a real loopback round trip (T23 owns that).
// Set ZILO_T13_RECORD=1 to also measure the hung-port verdict and write the log file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setup } from './test-support/harness.js';

const RECORD = process.env.ZILO_T13_RECORD === '1';

async function sample(n: number, run: () => Promise<void>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n + 2; i++) {
    const t0 = performance.now();
    await run();
    if (i >= 2) out.push(Math.round((performance.now() - t0) * 100) / 100);
  }
  return out;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Number.NaN;
}

describe('detection timings (PLAN §8, recorded, not gated)', () => {
  it('measures ready and unreachable verdicts', async () => {
    const ready = await sample(20, async () => {
      const h = setup();
      expect((await h.client.connect()).state).toBe('ready');
    });
    const refused = await sample(20, async () => {
      const h = setup();
      h.agent.up = false;
      expect((await h.client.connect()).state).toBe('unreachable-or-blocked');
      h.client.detection.cancel();
    });
    const result: Record<string, unknown> = {
      environment: `node ${process.version}, in-process contract mock (no network)`,
      samples: 'two warm-ups discarded, then 20 (3 for hung ports)',
      readyMs: { values: ready, p95: p95(ready), budgetMs: 300 },
      unreachableRefusedMs: { values: refused, p95: p95(refused), budgetMs: 2000 },
    };
    if (RECORD) {
      const hung = await sample(3, async () => {
        const h = setup();
        h.agent.delayMs = 60_000; // every port accepts but never answers
        expect((await h.client.connect()).state).toBe('unreachable-or-blocked');
        h.client.detection.cancel();
      });
      result.unreachableHungMs = { values: hung, max: Math.max(...hung), budgetMs: 2000 };
      const dir = new URL('../../../docs/validation/logs/T13/', import.meta.url);
      mkdirSync(dir, { recursive: true });
      writeFileSync(new URL('detection-timings.json', dir), `${JSON.stringify(result, null, 2)}\n`);
    }
    expect(ready).toHaveLength(20);
  }, 30_000);
});
