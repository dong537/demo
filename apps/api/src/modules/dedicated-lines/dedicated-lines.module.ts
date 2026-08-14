import { Module } from '@nestjs/common';
import { DeliveryRoutesController, DedicatedLineDeliveryController } from './delivery-routes.controller';
import { DeliveryRouteImportUseCase } from './delivery-route-import.use-case';
import { DedicatedLineDeliveryUseCase } from './dedicated-line-delivery.use-case';
import { ConfigService } from '../../common/config/config.service';
import { DedicatedLineControlPlaneAdminController } from './dedicated-line-control-plane.admin.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { WalletModule } from '../wallet/wallet.module';
import { RenewDedicatedLineUseCase } from './renew-dedicated-line.use-case';
import { DedicatedLineLifecycleUseCase } from './dedicated-line-lifecycle.use-case';
import { UpdateDedicatedLineLimitsUseCase } from './update-dedicated-line-limits.use-case';
import { ListDedicatedLineLimitsUseCase } from './list-dedicated-line-limits.use-case';
import { CreatePlacementPolicyUseCase } from './create-placement-policy.use-case';
import { LineDomainBindingsUseCase } from './line-domain-bindings.use-case';

@Module({
  imports: [CatalogModule, WalletModule],
  controllers: [DeliveryRoutesController, DedicatedLineDeliveryController, DedicatedLineControlPlaneAdminController],
  providers: [ConfigService, DeliveryRouteImportUseCase, DedicatedLineDeliveryUseCase, RenewDedicatedLineUseCase, DedicatedLineLifecycleUseCase, ListDedicatedLineLimitsUseCase, UpdateDedicatedLineLimitsUseCase, CreatePlacementPolicyUseCase, LineDomainBindingsUseCase],
  exports: [DeliveryRouteImportUseCase, DedicatedLineDeliveryUseCase, RenewDedicatedLineUseCase],
})
export class DedicatedLinesModule {}
