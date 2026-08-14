import { Module } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { BarkAlertOutboxRepository } from './bark-alert-outbox.repository';
import { BarkClient, parseBarkDeviceKeys } from './bark.client';
import { ProcessBarkInventoryAlertUseCase } from './process-bark-inventory-alert.use-case';

@Module({
  providers: [
    ConfigService,
    BarkAlertOutboxRepository,
    ProcessBarkInventoryAlertUseCase,
    {
      provide: BarkClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new BarkClient({
        serverUrl: config.get('BARK_SERVER_URL'),
        deviceKeys: parseBarkDeviceKeys(config.get('BARK_DEVICE_KEYS')),
        timeoutMs: config.get('BARK_REQUEST_TIMEOUT_MS'),
      }),
    },
  ],
  exports: [BarkAlertOutboxRepository, ProcessBarkInventoryAlertUseCase],
})
export class AlertsModule {}
