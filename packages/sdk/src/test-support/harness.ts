// Test wiring: a ZiloClient talking to the contract mock agent, with a controllable clock.
import { ZiloClient, type ZiloClientOptions } from '../client.js';
import type { PermissionsLike } from '../permission.js';
import { MockAgent, PAGE_ORIGIN, fixtures } from './mock-agent.js';

export function permissions(state: string): PermissionsLike {
  return {
    query: () =>
      state === 'throws'
        ? Promise.reject(new TypeError('unsupported'))
        : Promise.resolve({ state }),
  };
}

export interface Harness {
  agent: MockAgent;
  client: ZiloClient;
  logs: { event: string; fields: Record<string, unknown> }[];
  /** Runs before the mock agent; return a promise to replace the agent's answer. */
  intercept: ((url: string, init: RequestInit) => Promise<Response> | undefined) | undefined;
}

export function setup(options: Partial<ZiloClientOptions> & { consent?: string } = {}): Harness {
  const agent = new MockAgent(48100);
  agent.consent = options.consent ?? 'granted';
  agent.devices = [fixtures.virtualDevice, fixtures.futureDevice];
  agent.caps.set('virtual-0', fixtures.virtualCaps);
  agent.caps.set('future.1', fixtures.futureCaps);
  const logs: Harness['logs'] = [];
  const h = { agent, logs, intercept: undefined } as Omit<Harness, 'client'> & {
    client?: ZiloClient;
  };
  const client = new ZiloClient({
    origin: PAGE_ORIGIN,
    fetch: (url, init) => h.intercept?.(url, init) ?? agent.fetch(url, init),
    permissions: permissions('granted'),
    isSafari: false,
    logger: (event, fields) => logs.push({ event, fields }),
    ...options,
  });
  if (options.now !== undefined) agent.now = options.now;
  h.client = client;
  return h as Harness;
}
