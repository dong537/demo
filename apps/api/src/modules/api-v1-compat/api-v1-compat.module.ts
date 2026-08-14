import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DedicatedLineOrdersModule } from '../dedicated-line-orders/dedicated-line-orders.module';
import { DedicatedLinesModule } from '../dedicated-lines/dedicated-lines.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { ConfigService } from '../../common/config/config.service';
import { ApiV1CompatController } from './api-v1-compat.controller';

@Module({
  imports: [AuthModule, CatalogModule, DedicatedLineOrdersModule, DedicatedLinesModule, UsersModule, WalletModule],
  controllers: [ApiV1CompatController],
  providers: [ConfigService],
})
export class ApiV1CompatModule {}
