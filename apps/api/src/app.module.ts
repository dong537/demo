import { Module, MiddlewareConsumer } from '@nestjs/common';
import { RequestIdMiddleware } from './common/logging/request-id.middleware';
import { MaintenanceMiddleware } from './common/maintenance/maintenance.middleware';
import { HealthController } from './modules/health/health.controller';
import { ConfigService } from './common/config/config.service';
import { LoggerService } from './common/logging/logger.service';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { ResourcesModule } from './modules/resources/resources.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProxiesModule } from './modules/proxies/proxies.module';
import { OpenApiModule } from './modules/openapi/openapi.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { SitesModule } from './modules/sites/sites.module';
import { UpstreamAccountsModule } from './modules/upstream-accounts/upstream-accounts.module';
import { UsersModule } from './modules/users/users.module';
import { AuditModule } from './modules/audit/audit.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProxyCheckModule } from './modules/proxy-check/proxy-check.module';
import { UpstreamRequestLogsModule } from './modules/upstream-request-logs/upstream-request-logs.module';
import { CustomerResellerModule } from './modules/customer-reseller/customer-reseller.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DedicatedLineOrdersModule } from './modules/dedicated-line-orders/dedicated-line-orders.module';
import { DedicatedLinesModule } from './modules/dedicated-lines/dedicated-lines.module';
import { DedicatedLineMigrationsModule } from './modules/dedicated-line-migrations/dedicated-line-migrations.module';
import { DedicatedLineHealthModule } from './modules/dedicated-line-health/dedicated-line-health.module';
import { ProductionReadinessModule } from './modules/production-readiness/production-readiness.module';
import { ApiV1CompatModule } from './modules/api-v1-compat/api-v1-compat.module';

@Module({
  imports: [AuthModule, ApiKeysModule, WalletModule, PaymentsModule, ProvidersModule, ResourcesModule, PricingModule, OrdersModule, ProxiesModule, OpenApiModule, TenantsModule, SitesModule, UpstreamAccountsModule, UsersModule, AuditModule, TicketsModule, NotificationsModule, ProxyCheckModule, UpstreamRequestLogsModule, CustomerResellerModule, CatalogModule, DedicatedLineOrdersModule, DedicatedLinesModule, DedicatedLineMigrationsModule, DedicatedLineHealthModule, ProductionReadinessModule, ApiV1CompatModule],
  controllers: [HealthController],
  providers: [ConfigService, LoggerService],
  exports: [ConfigService, LoggerService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    consumer.apply(MaintenanceMiddleware).forRoutes('*');
  }
}
