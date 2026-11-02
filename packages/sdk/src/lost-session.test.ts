// CONTRACT.md §12 (R-R1 to R-R3), including its SDK acceptance vector.
import { describe, expect, it } from 'vitest';
import { ZiloAgentRestartedError, ZiloProblemError, isProblem } from './errors.js';
import { ZiloJobLostError, type TrackedJob } from './client.js';
import { setup } from './test-support/harness.js';

const scan = { deviceId: 'virtual-0', settings: { source: 'flatbed' as const } };

describe('lost-session contract', () => {
  it('records the instanceId from the full hello before the first job of a family', async () => {
    const h = setup();
    await h.client.connect();
    const hellosBefore = h.agent.ops('getHello');
    const job = await h.client.createJob(scan);
    const tracked = h.client.trackedJobs.find((j) => j.id === job.id);
    expect(tracked?.instanceId).toBe(h.agent.instanceId);
    // The family's instance was already read by detection; no extra hello is needed.
    expect(h.agent.ops('getHello')).toBe(hellosBefore);
  });

  it('acceptance vector: restart marks J1 and J2 agent-restarted, drops families, never rescans', async () => {
    const h = setup();
    await h.client.connect();
    const j1 = await h.client.createJob(scan);
    const j2 = await h.client.createJob(scan);
    const rec1 = h.agent.jobs.get(j1.id);
    if (rec1 !== undefined) rec1.job.state = 'completed';
    const oldInstance = h.agent.instanceId;
    const lost: TrackedJob[][] = [];
    h.client.onJobsLost((jobs) => lost.push([...jobs]));

    h.agent.restart();
    expect(h.agent.instanceId).not.toBe(oldInstance);
    const creates = h.agent.ops('createJob');

    // J2's next request gets 401 token-invalid; the SDK acquires a new family and reads hello B.
    const err = await h.client.getJob(j2.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZiloAgentRestartedError);
    expect((err as ZiloAgentRestartedError).retryable).toBe(true);
    expect((err as ZiloAgentRestartedError).code).toBe('agent-restarted');
    expect(h.client.trackedJobs.map((j) => j.outcome)).toEqual([
      'agent-restarted',
      'agent-restarted',
    ]);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.map((j) => j.id).sort()).toEqual([j1.id, j2.id].sort());
    expect(h.agent.ops('issueToken')).toBe(2);

    // J1 is classified without a wire request; nothing is rescanned or re-exported.
    const before = h.agent.log.length;
    await expect(h.client.getJob(j1.id)).rejects.toBeInstanceOf(ZiloAgentRestartedError);
    expect(h.agent.log.length).toBe(before);
    expect(h.agent.ops('createJob')).toBe(creates);

    // With the new token, the agent answers J1 with a typed 404 (it never names a new job).
    const res = await h.agent.fetch(`http://127.0.0.1:48100/zilo/v1/jobs/${j1.id}`, {
      headers: { Authorization: `Bearer ${h.agent.log.at(-1)?.token ?? ''}` },
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not-found');
  });

  it('agent-restarted is SDK-local: not a wire problem code', () => {
    const err = new ZiloAgentRestartedError('j');
    expect(err).not.toBeInstanceOf(ZiloProblemError);
  });

  it('detects a restart on a transport failure too (R-R3 recovery path)', async () => {
    const h = setup();
    await h.client.connect();
    const j = await h.client.createJob(scan);
    // The agent restarts mid-request: the request dies with a TypeError, then hello answers again.
    h.intercept = (url) => {
      if (!url.includes('/jobs/')) return undefined;
      h.intercept = undefined;
      h.agent.restart();
      return Promise.reject(new TypeError('Failed to fetch'));
    };
    await expect(h.client.getJob(j.id)).rejects.toBeInstanceOf(ZiloAgentRestartedError);
    expect(h.agent.ops('getConsent')).toBe(1); // R-A13 check: consent still granted
    expect(h.client.trackedJobs[0]?.outcome).toBe('agent-restarted');
  });

  it('same instance: a tracked job that is gone is not-found, not agent-restarted', async () => {
    const h = setup();
    await h.client.connect();
    const j = await h.client.createJob(scan);
    h.agent.jobs.delete(j.id); // e.g. disposed at TTL
    const err = await h.client.getJob(j.id).catch((e: unknown) => e);
    expect(isProblem(err, 'not-found')).toBe(true);
    expect(h.client.trackedJobs).toHaveLength(0);
  });

  it('same instance: a job whose family lapsed is reported as lost (not-found copy)', async () => {
    const h = setup();
    await h.client.connect();
    const j = await h.client.createJob(scan);
    h.agent.inject.set('getJob', [{ status: 401, code: 'token-invalid' }]);
    const err = await h.client.getJob(j.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZiloJobLostError);
    expect((err as ZiloJobLostError).code).toBe('not-found');
  });

  it('an unknown job gets the typed 404', async () => {
    const h = setup();
    await h.client.connect();
    const err = await h.client.getJob('AAAAAAAAAAAAAAAAAAAA').catch((e: unknown) => e);
    expect(isProblem(err, 'not-found')).toBe(true);
    expect((err as ZiloProblemError).status).toBe(404);
  });

  it('disposes a tracked job with its family credential and stops tracking it', async () => {
    const h = setup();
    await h.client.connect();
    const j = await h.client.createJob(scan);
    await h.client.disposeJob(j.id);
    expect(h.agent.ops('disposeJob')).toBe(1);
    expect(h.client.trackedJobs).toHaveLength(0);
  });
});
