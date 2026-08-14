import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import type * as https from 'node:https';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../../common/config/config.service';
import { HttpProxyProber, type ProbeTransport } from './proxy-prober';

vi.mock('http-proxy-agent', () => ({
  HttpProxyAgent: class HttpProxyAgent {
    constructor(readonly url: string) {}
  },
}));

vi.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: class HttpsProxyAgent {
    constructor(readonly url: string) {}
  },
}));

vi.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: class SocksProxyAgent {
    constructor(readonly url: string) {}
  },
}));

type RequiredProbeTransport = Exclude<ProbeTransport, undefined>;

function config(targetUrl: string, timeoutMs = 8000): ConfigService {
  return {
    get(key: string) {
      if (key === 'PROXY_CHECK_TARGET_URL') return targetUrl;
      if (key === 'PROXY_CHECK_TIMEOUT_MS') return timeoutMs;
      throw new Error(`unexpected config key ${key}`);
    },
  } as unknown as ConfigService;
}

function transport(options: { statusCode?: number; body?: string; error?: Error } = {}) {
  const fn = vi.fn<RequiredProbeTransport>((_target, _requestOptions, callback) => {
    const request = new EventEmitter() as http.ClientRequest;
    request.destroy = vi.fn() as unknown as http.ClientRequest['destroy'];

    process.nextTick(() => {
      if (options.error) {
        request.emit('error', options.error);
        return;
      }

      const response = new EventEmitter() as http.IncomingMessage;
      response.statusCode = options.statusCode ?? 200;
      callback(response);
      response.emit('data', Buffer.from(options.body ?? '{"ip":"198.51.100.9"}'));
      response.emit('end');
    });

    return request;
  });
  return fn;
}

function agentUrl(options: http.RequestOptions | https.RequestOptions): string {
  return String((options as unknown as { agent: { url: string } }).agent.url);
}

describe('HttpProxyProber', () => {
  it('uses HTTP proxy agent when the configured probe target is http', async () => {
    const probeTransport = transport();
    const prober = new HttpProxyProber(config('http://api.ipify.org/?format=json'), probeTransport);

    const outcome = await prober.probe({
      ip: '203.0.113.10',
      port: 8080,
      username: 'user name',
      password: 'pass:word',
      protocol: 'HTTP',
    });

    expect(outcome).toMatchObject({ reachable: true, exitIp: '198.51.100.9' });
    const [target, requestOptions] = probeTransport.mock.calls[0]!;
    expect(target.href).toBe('http://api.ipify.org/?format=json');
    expect(agentUrl(requestOptions)).toBe('http://user%20name:pass%3Aword@203.0.113.10:8080');
  });

  it('uses HTTPS probe target when configured without forcing the HTTP endpoint', async () => {
    const probeTransport = transport();
    const prober = new HttpProxyProber(config('https://api.ipify.org/?format=json'), probeTransport);

    const outcome = await prober.probe({
      ip: '203.0.113.10',
      port: 8080,
      username: 'proxy-user',
      password: 'proxy-pass',
      protocol: 'HTTP',
    });

    expect(outcome.reachable).toBe(true);
    const [target, requestOptions] = probeTransport.mock.calls[0]!;
    expect(target.href).toBe('https://api.ipify.org/?format=json');
    expect(agentUrl(requestOptions)).toBe('http://proxy-user:proxy-pass@203.0.113.10:8080');
  });

  it('keeps SOCKS5 probes on the configured target protocol without leaking network errors', async () => {
    const probeTransport = transport({ error: new Error('connect failed') });
    const prober = new HttpProxyProber(config('http://api.ipify.org/?format=json'), probeTransport);

    const outcome = await prober.probe({
      ip: '203.0.113.20',
      port: 1080,
      username: 'proxy-user',
      password: 'proxy-pass',
      protocol: 'SOCKS5',
    });

    expect(outcome).toEqual({ reachable: false, timedOut: false });
    const [, requestOptions] = probeTransport.mock.calls[0]!;
    expect(agentUrl(requestOptions)).toBe('socks5://proxy-user:proxy-pass@203.0.113.20:1080');
  });
});
