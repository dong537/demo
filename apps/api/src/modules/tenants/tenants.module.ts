import { Module } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { ProvidersModule } from '../providers/providers.module';
import { ResourcesModule } from '../resources/resources.module';
import { TenantBrandController } from './tenant-brand.controller';
import { TenantProviderAccountsController } from './tenant-provider-accounts.controller';
import { TenantProviderAccountsRepository } from './tenant-provider-accounts.repository';
import { TenantsController } from './tenants.controller';
import { TenantsRepository } from './tenants.repository';
import { CreateSelfServiceTenantUseCase } from './use-cases/create-self-service-tenant.use-case';

@Module({
  imports: [ProvidersModule, ResourcesModule],
  controllers: [TenantsController, TenantBrandController, TenantProviderAccountsController],
  providers: [TenantsRepository, TenantProviderAccountsRepository, CreateSelfServiceTenantUseCase, ConfigService],
  exports: [TenantsRepository, TenantProviderAccountsRepository],
})
export class TenantsModule {}
