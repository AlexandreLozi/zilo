import { describe, expect, it } from 'vitest';
import { resolutionChoice } from './decode.js';
import { ZiloProtocolError, isProblem } from './errors.js';
import { setup } from './test-support/harness.js';

describe('devices (R-D1)', () => {
  it('lists the cached devices with GET, and refreshes with POST', async () => {
    const h = setup();
    await h.client.connect();
    const list = await h.client.listDevices();
    expect(list.devices.map((d) => d.id)).toEqual(['virtual-0', 'future.1']);
    expect(h.agent.ops('refreshDevices')).toBe(0);
    const refreshed = await h.client.refreshDevices();
    expect(refreshed.discovery.state).toBe('idle');
    expect(h.agent.log.filter((l) => l.op === 'refreshDevices').map((l) => l.method)).toEqual([
      'POST',
    ]);
  });

  it('keeps unknown enum values and unknown fields (R-V4)', async () => {
    const h = setup();
    await h.client.connect();
    const future = (await h.client.listDevices()).devices[1];
    expect(future?.driver).toBe('holo-scan');
    expect(future?.connection).toBe('quantum-link');
    expect((future as Record<string, unknown> | undefined)?.colorProfile).toBe('sRGB');
  });

  it('rejects a device list that breaks a required field', async () => {
    const { decodeDeviceList } = await import('./decode.js');
    const bad = {
      devices: [{ id: 'x', name: 'missing driver', connection: 'usb' }],
      discovery: { state: 'idle' },
    };
    expect(() => decodeDeviceList(bad)).toThrow(/device\.driver/);
  });
});

describe('caps (R-D4)', () => {
  it('decodes list and range resolutions', async () => {
    const h = setup();
    await h.client.connect();
    const caps = await h.client.getCaps('virtual-0');
    const [flatbed, feeder] = caps.sources;
    expect(flatbed && resolutionChoice(flatbed)).toEqual({
      kind: 'list',
      values: [75, 150, 300, 600],
    });
    expect(feeder && resolutionChoice(feeder)).toEqual({
      kind: 'range',
      min: 100,
      max: 600,
      step: 100,
    });
    expect(feeder?.maxPages).toBe(50);
  });

  it('applies the safe fallback for an unknown kind and keeps every unknown value', async () => {
    const h = setup();
    await h.client.connect();
    const caps = await h.client.getCaps('future.1');
    const src = caps.sources[0];
    if (src === undefined) throw new Error('no source');
    expect(resolutionChoice(src)).toEqual({
      kind: 'unsupported',
      wireKind: 'stepped-set',
      defaultResolution: 1200,
    });
    expect(src.source).toBe('film-holder');
    expect(src.colorModes).toContain('cmyk');
    expect((src as Record<string, unknown>).lightSource).toBe('transmissive');
    expect((src.resolutions as Record<string, unknown>).hint).toBe('opaque');
    expect((caps as Record<string, unknown>).futureTopLevel).toEqual({ nested: true });
  });

  it('encodes the device id in the path and maps an unknown device to a typed 404', async () => {
    const h = setup();
    await h.client.connect();
    const err = await h.client.getCaps('no such/device').catch((e: unknown) => e);
    expect(isProblem(err, 'not-found')).toBe(true);
    expect(h.agent.log.at(-1)?.op).toBe('getDeviceCaps');
  });

  it('maps device-busy to its typed error', async () => {
    const h = setup();
    await h.client.connect();
    h.agent.inject.set('getDeviceCaps', [{ status: 409, code: 'device-busy' }]);
    const err = await h.client.getCaps('virtual-0').catch((e: unknown) => e);
    expect(isProblem(err, 'device-busy') && err.retryable).toBe(true);
  });

  it('rejects malformed known kinds instead of guessing', async () => {
    const { decodeCaps } = await import('./decode.js');
    const bad = {
      deviceId: 'd',
      sources: [
        {
          source: 'flatbed',
          resolutions: { kind: 'list', values: [] },
          colorModes: ['color'],
          pageSizes: [{ id: 'a4', widthMm: 210, heightMm: 297 }],
          maxAreaMm: { widthMm: 216, heightMm: 356 },
          customPageSize: false,
          defaults: { resolution: 300, colorMode: 'color', pageSize: 'a4' },
        },
      ],
    };
    expect(() => decodeCaps(bad)).toThrow(ZiloProtocolError);
  });
});
