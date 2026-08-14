import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { LoginUseCase } from './use-cases/login.use-case';
import { LogoutUseCase } from './use-cases/logout.use-case';
import { ChangePasswordUseCase } from './use-cases/change-password.use-case';
import { RegisterUserUseCase } from './use-cases/register-user.use-case';
import { ConfigService } from '../../common/config/config.service';
import { JwtStrategy } from '../../common/auth/jwt.strategy';
import { ApiKeyStrategy } from '../../common/auth/apikey.strategy';
import {
  AuthGuard,
  UserGuard,
  OperatorGuard,
  TenantAdminGuard,
  PlatformAdminGuard,
  SystemGuard,
} from '../../common/auth/guards';
import { ApiKeysRepository } from '../api-keys/api-keys.repository';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthRepository,
    ApiKeysRepository,
    JwtStrategy,
    ApiKeyStrategy,
    AuthGuard,
    UserGuard,
    OperatorGuard,
    TenantAdminGuard,
    PlatformAdminGuard,
    SystemGuard,
    LoginUseCase,
    LogoutUseCase,
    ChangePasswordUseCase,
    RegisterUserUseCase,
    ConfigService,
  ],
  exports: [
    AuthRepository,
    ApiKeysRepository,
    JwtStrategy,
    ApiKeyStrategy,
    AuthGuard,
    UserGuard,
    OperatorGuard,
    TenantAdminGuard,
    PlatformAdminGuard,
    SystemGuard,
  ],
})
export class AuthModule {}
