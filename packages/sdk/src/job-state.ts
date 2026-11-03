// Job state machine (CONTRACT.md §5.2). The SDK mirrors the transitions the agent sends and never
// invents one: `agent-restarted` is a separate SDK-local outcome (R-R3), not a job state. The
// tables below exist so a wire transition the contract forbids is a protocol error, not silently
// accepted, and so callers can ask what is terminal, settled or active.
import { ZiloProtocolError } from './errors.js';
import type { JobState, JobStateKnown } from './types.js';

/** States that emit `done` (§5.2). `disposed` is a tombstone, not a terminal state. */
export const TERMINAL_STATES = ['completed', 'failed', 'cancelled'] as const;

/** States in which the device may still acquire pages (§5.2). */
export const ACTIVE_STATES = ['queued', 'scanning'] as const;

/**
 * Every transition §5.2 allows, keyed by the state it leaves. `queued` is the creation point, so
 * it has no entry: nothing transitions *into* existence. A compound transition (`cancelled`,
 * `done`, `disposed`) is appended as one atomic step by the agent (R-E4), so `queued ->
 * disposed`, `scanning -> disposed` and the terminal-to-`disposed` edges are all in the table.
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStateKnown, readonly JobStateKnown[]>> = {
  queued: ['scanning', 'failed', 'cancelled', 'disposed'],
  scanning: ['completed', 'failed', 'cancelled', 'disposed'],
  completed: ['disposed'],
  failed: ['disposed'],
  cancelled: ['disposed'],
  disposed: [],
};

export function isTerminalState(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/** Ready to receive nothing more: terminal, or the `disposed` tombstone (§5.2 "settled"). */
export function isSettledState(state: string): boolean {
  return state === 'disposed' || isTerminalState(state);
}

/** A job that may still acquire pages (`queued`, `scanning`, or an unknown future active state). */
export function isActiveState(state: string): boolean {
  return !isSettledState(state);
}

/**
 * True when `to` follows `from` under §5.2. A state the contract does not name (an unknown value
 * of the open `JobState` enum, R-V4) is opaque: it is neither rejected nor treated as terminal.
 */
export function canJobTransition(from: string, to: string): boolean {
  if (from === to) return false;
  if (!(from in JOB_TRANSITIONS) || !(to in JOB_TRANSITIONS)) return true;
  return (JOB_TRANSITIONS[from as JobStateKnown] as readonly string[]).includes(to);
}

/**
 * Validates one observed transition without inventing anything. Unknown states pass through
 * unchanged; a known, forbidden transition is a contract breach (`ZiloProtocolError`), so the SDK
 * never presents a state the agent did not transition to.
 */
export function applyJobTransition(from: JobState, to: JobState): JobState {
  if (!canJobTransition(from, to)) {
    throw new ZiloProtocolError(`job transition ${String(from)} -> ${String(to)} is not in §5.2`);
  }
  return to;
}

/** The terminal state a `done` event must carry: `done` never carries `disposed` (§5.2). */
export function terminalState(value: string): string {
  if (!isTerminalState(value)) {
    throw new ZiloProtocolError('done.state must be completed, failed or cancelled');
  }
  return value;
}
