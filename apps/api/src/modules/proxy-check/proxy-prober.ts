import { Inject, Injectable, Optional } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ConfigService } from '../../common/config/config.service';

export type ProbeProtocol = 'HTTP' | 'SOCKS5';

export interface ProbeRequest {
  ip: string;
  port: number;
  username: string;
  password: string;
  protocol: ProbeProtocol;
}

export type ProbeOutcome =
  | { reachable: true; latencyMs: number; exitIp?: string }
  | { reachable: false; timedOut: boolean };

/**
 * Network seam: performs a single controlled outbound request through the given
 * proxy to a fixed probe target. Implementations must never throw on network
 * failures; unreachable/timeout are normal results.
 */
export interface ProxyProber {
  probe(request: ProbeRequest): Promise<ProbeOutcome>;
}

export const PROXY_PROBER = Symbol('PROXY_PROBER');
export const PROXY_PROBER_TRANSPORT = Symbol('PROXY_PROBER_TRANSPORT');

export type ProbeTransport = (
  target: URL,
  options: http.RequestOptions | https.RequestOptions,
  callback: (res: http.IncomingMessage) => void,
) => http.ClientRequest;

const defaultProbeTransport: ProbeTransport = (target, options, callback) =>
  (target.protocol === 'http:' ? http.get : https.get)(target, options, callback);

function buildProxyUrl(req: ProbeRequest): string {
  const scheme = req.protocol === 'SOCKS5' ? 'socks5' : 'http';
  const auth = `${encodeURIComponent(req.username)}:${encodeURIComponent(req.password)}`;
  return `${scheme}://${auth}@${req.ip}:${req.port}`;
}

function buildAgent(req: ProbeRequest, target: URL): http.Agent | https.Agent {
  const url = buildProxyUrl(req);
  if (req.protocol === 'SOCKS5') return new SocksProxyAgent(url);
  return target.protocol === 'http:' ? new HttpProxyAgent(url) : new HttpsProxyAgent(url);
}

function parseProbeTargetUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function extractExitIp(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { ip?: unknown };
    if (typeof parsed.ip === 'string' && parsed.ip.length > 0) return parsed.ip;
  } catch {
    // Probe target may not return JSON; the exit IP is best-effort only.
  }
  return undefined;
}

@Injectable()
export class HttpProxyProber implements ProxyProber {
  private readonly transport: ProbeTransport;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(PROXY_PROBER_TRANSPORT) transport?: ProbeTransport,
  ) {
    this.transport = transport ?? defaultProbeTransport;
  }

  async probe(req: ProbeRequest): Promise<ProbeOutcome> {
    const targetUrl = this.config.get('PROXY_CHECK_TARGET_URL');
    const timeoutMs = this.config.get('PROXY_CHECK_TIMEOUT_MS');
    const target = parseProbeTargetUrl(targetUrl);
    if (!target) return { reachable: false, timedOut: false };
    const startedAt = Date.now();

    return new Promise<ProbeOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: ProbeOutcome): void => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      let agent: http.Agent | https.Agent;
      try {
        agent = buildAgent(req, target);
      } catch {
        finish({ reachable: false, timedOut: false });
        return;
      }

      const request = this.transport(target, { agent, timeout: timeoutMs }, (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          // Cap body read; the probe only needs the small exit-IP payload.
          if (size < 4096) {
            chunks.push(chunk);
            size += chunk.length;
          }
        });
        res.on('end', () => {
          if (status >= 200 && status < 400) {
            const body = Buffer.concat(chunks).toString('utf8');
            finish({ reachable: true, latencyMs: Date.now() - startedAt, exitIp: extractExitIp(body) });
          } else {
            finish({ reachable: false, timedOut: false });
          }
        });
        res.on('error', () => finish({ reachable: false, timedOut: false }));
      });

      request.on('timeout', () => {
        request.destroy();
        finish({ reachable: false, timedOut: true });
      });
      request.on('error', () => finish({ reachable: false, timedOut: false }));
    });
  }
}
