import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarkClient } from './bark.client';

describe('BarkClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts inventory alerts to the configured Bark server without placing device keys in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BarkClient({
      serverUrl: 'https://bark.example.test',
      deviceKeys: ['device-a', 'device-b'],
      timeoutMs: 1_000,
    });

    await client.send({
      title: '365Proxy 库存不足',
      body: 'SKU SV / HK: requested 2, available 0',
      group: '365proxy-inventory',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://bark.example.test/push',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      title: '365Proxy 库存不足',
      body: 'SKU SV / HK: requested 2, available 0',
      group: '365proxy-inventory',
      device_keys: ['device-a', 'device-b'],
      level: 'timeSensitive',
    });
  });

  it('classifies a 429 response as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    const client = new BarkClient({ serverUrl: 'https://bark.example.test', deviceKeys: ['device-a'], timeoutMs: 1_000 });

    await expect(client.send({ title: 't', body: 'b', group: 'g' })).rejects.toMatchObject({
      code: 'BARK_HTTP_429',
      retryable: true,
      ambiguous: false,
    });
  });

  it('classifies transport failures as ambiguous rather than retrying a potentially delivered notification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));
    const client = new BarkClient({ serverUrl: 'https://bark.example.test', deviceKeys: ['device-a'], timeoutMs: 1_000 });

    await expect(client.send({ title: 't', body: 'b', group: 'g' })).rejects.toMatchObject({
      code: 'BARK_TRANSPORT_ERROR',
      retryable: false,
      ambiguous: true,
    });
  });
});
