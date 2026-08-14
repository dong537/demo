export type BarkNotification = {
  title: string;
  body: string;
  group: string;
};

export type BarkClientOptions = {
  serverUrl: string;
  deviceKeys: string[];
  timeoutMs: number;
};

export class BarkDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly ambiguous: boolean,
  ) {
    super(code);
    this.name = 'BarkDeliveryError';
  }
}

export class BarkClient {
  constructor(private readonly options: BarkClientOptions) {}

  async send(notification: BarkNotification): Promise<void> {
    if (this.options.deviceKeys.length === 0) {
      throw new BarkDeliveryError('BARK_DEVICE_KEYS_MISSING', false, false);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(barkPushUrl(this.options.serverUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          title: notification.title,
          body: notification.body,
          group: notification.group,
          device_keys: this.options.deviceKeys,
          level: 'timeSensitive',
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new BarkDeliveryError(`BARK_HTTP_${response.status}`, retryable, false);
      }
    } catch (error: unknown) {
      if (error instanceof BarkDeliveryError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new BarkDeliveryError('BARK_TIMEOUT', false, true);
      }
      throw new BarkDeliveryError('BARK_TRANSPORT_ERROR', false, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseBarkDeviceKeys(value: string): string[] {
  return [...new Set(value.split(',').map((key) => key.trim()).filter(Boolean))];
}

function barkPushUrl(serverUrl: string): string {
  const base = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
  return new URL('push', base).toString();
}
