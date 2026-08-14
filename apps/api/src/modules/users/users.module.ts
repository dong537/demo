import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { GetMeUseCase } from './use-cases/get-me.use-case';
import { UpdateMeUseCase } from './use-cases/update-me.use-case';
import { ImpersonateUserUseCase } from './use-cases/impersonate-user.use-case';
import { CreateUserUseCase } from './use-cases/create-user.use-case';
import { ConfigService } from '../../common/config/config.service';

@Module({
  controllers: [UsersController],
  providers: [UsersRepository, GetMeUseCase, UpdateMeUseCase, ImpersonateUserUseCase, CreateUserUseCase, ConfigService],
  exports: [UsersRepository, GetMeUseCase],
})
export class UsersModule {}
