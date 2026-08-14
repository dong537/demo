import { Injectable } from '@nestjs/common';
import { BarkClient, BarkDeliveryError, BarkNotification } from './bark.client';
import { BarkAlertOutboxRepository, BarkOutboxEvent } from './bark-alert-outbox.repository';

export type BarkAlertExecutionResult =
  | { status: 'NOOP'; eventId: string }
  | { status: 'PUBLISHED'; eventId: string }
  | { status: 'RETRYING'; eventId: string; attempts: number; error: string }
  | { status: 'FAILED'; eventId: string; error: string }
  | { status: 'NEEDS_OPERATOR'; eventId: string; error: string };

@Injectable()
export class ProcessBarkInventoryAlertUseCase {
  constructor(
    private readonly outbox: BarkAlertOutboxRepository,
    private readonly bark: BarkClient,
  ) {}

  async execute(eventId: string, workerId: string): Promise<BarkAlertExecutionResult> {
    const event = await this.outbox.claimRunnableEvent(eventId, workerId);
    if (!event) return { status: 'NOOP', eventId };

    try {
      await this.bark.send(notificationFrom(event));
      await this.outbox.markPublished(event, workerId);
      return { status: 'PUBLISHED', eventId };
    } catch (error: unknown) {
      if (error instanceof BarkDeliveryError) {
        if (error.ambiguous) {
          await this.outbox.markNeedsOperator(event, workerId, error.code);
          return { status: 'NEEDS_OPERATOR', eventId, error: error.code };
        }
        if (error.retryable) {
          const status = await this.outbox.markRetryableFailure(event, workerId, error.code);
          return status === 'RETRYING'
            ? { status, eventId, attempts: event.attempt, error: error.code }
            : { status, eventId, error: error.code };
        }
        await this.outbox.markFailed(event, workerId, error.code);
        return { status: 'FAILED', eventId, error: error.code };
      }
      await this.outbox.markNeedsOperator(event, workerId, 'BARK_UNKNOWN_ERROR');
      return { status: 'NEEDS_OPERATOR', eventId, error: 'BARK_UNKNOWN_ERROR' };
    }
  }
}

function notificationFrom(event: BarkOutboxEvent): BarkNotification {
  const payload = jsonObject(event.payload);
  const skuId = requiredString(payload, 'skuId');
  const countryCode = requiredString(payload, 'countryCode');
  const providerCode = requiredString(payload, 'providerCode');
  const requestedQuantity = requiredNonNegativeInteger(payload, 'requestedQuantity');
  const availableQuantity = requiredNonNegativeInteger(payload, 'availableQuantity');
  return {
    title: '365Proxy 专线库存不足',
    body: [
      `SKU: ${skuId}`,
      `国家: ${countryCode}`,
      `请求数量: ${requestedQuantity}`,
      `可用数量: ${availableQuantity}`,
      `Provider: ${providerCode}`,
    ].join('\n'),
    group: '365proxy-inventory',
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== 'string' || !candidate.trim()) throw new BarkDeliveryError('BARK_EVENT_PAYLOAD_INVALID', false, false);
  return candidate.trim();
}

function requiredNonNegativeInteger(value: Record<string, unknown>, key: string): number {
  const candidate = value[key];
  if (!Number.isInteger(candidate) || (candidate as number) < 0) {
    throw new BarkDeliveryError('BARK_EVENT_PAYLOAD_INVALID', false, false);
  }
  return candidate as number;
}
