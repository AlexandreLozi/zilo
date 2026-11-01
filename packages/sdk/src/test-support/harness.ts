// Test wiring: a ZiloClient talking to the contract mock agent, with a controllable clock.
import { ZiloClient, type ZiloClientOptions } from '../client.js';
import type { PermissionsLike } from '../permission.js';
import { MockAgent, PAGE_ORIGIN, fixtures } from './mock-agent.js';

export function permissions(state: string | 'throws'): PermissionsLike {
  return {
    query: () => (state === 'throws' ? Promise.reject(new TypeError('unsupported')) : Promise.resolve({ state })),
  };
}

export interface Harness {
  agent: MockAgent;
  client: ZiloClient;
  logs: { event: string; fields: Record<string, unknown> }[];
}

export function setup(options: Partial<ZiloClientOptions> & { consent?: string } = {}): Harness {
  const agent = new MockAgent(48100);
  agent.consent = options.consent ?? 'granted';
  agent.devices = [fixtures.virtualDevice, fixtures.futureDevice];
  agent.caps.set('virtual-0', fixtures.virtualCaps);
  agent.caps.set('future.1', fixtures.futureCaps);
  const logs: Harness['logs'] = [];
  const client = new ZiloClient({
    origin: PAGE_ORIGIN,
    fetch: agent.fetch,
    permissions: permissions('granted'),
    isSafari: false,
    logger: (event, fields) => logs.push({ event, fields }),
    ...options,
  });
  if (options.now !== undefined) agent.now = options.now;
  return { agent, client, logs };
}
