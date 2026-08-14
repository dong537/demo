import { Controller, Get, Put, Post, Body, Param, Query } from '@nestjs/common';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PageQueryDto, PageResult } from '../../common/pagination/pagination.dto';
import { AdminUserListItem, UsersRepository } from './users.repository';
import { requireTenantId } from '../wallet/access';
import { GetMeUseCase } from './use-cases/get-me.use-case';
import { UpdateMeUseCase } from './use-cases/update-me.use-case';
import { ImpersonateUserUseCase } from './use-cases/impersonate-user.use-case';
import { CreateUserUseCase } from './use-cases/create-user.use-case';
import { CreatedUserDto, CreateUserDto, UpdateUserProfileDto, UserProfileDto } from './dto';

type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';
type UserListQuery = PageQueryDto & { status?: UserStatus; tenantId?: string };

@Controller('users')
export class UsersController {
  constructor(
    private readonly repo: UsersRepository,
    private readonly getMeUseCase: GetMeUseCase,
    private readonly updateMeUseCase: UpdateMeUseCase,
    private readonly impersonateUserUseCase: ImpersonateUserUseCase,
    private readonly createUserUseCase: CreateUserUseCase,
  ) {}

  @Get('me')
  @RequireAuth()
  async me(@CurrentContext() ctx: AuthenticatedContext): Promise<UserProfileDto> {
    return this.getMeUseCase.execute(ctx);
  }

  @Put('me')
  @RequireAuth()
  async updateMe(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: UpdateUserProfileDto,
  ): Promise<UserProfileDto> {
    return this.updateMeUseCase.execute(ctx, body);
  }

  @Get()
  @RequireAuth()
  async list(
    @CurrentContext() ctx: AuthenticatedContext,
    @Query() query: UserListQuery,
  ): Promise<PageResult<AdminUserListItem>> {
    if (ctx.ownerType === 'PLATFORM_ADMIN') {
      return this.repo.listUsers(ctx.siteId, query.tenantId ?? null, query);
    }
    if (ctx.ownerType === 'TENANT_ADMIN') {
      return this.repo.listUsers(ctx.siteId, requireTenantId(ctx), query);
    }
    throw new AppError(ErrorCode.PERMISSION_DENIED, 'insufficient_permissions', 403);
  }

  @Post()
  @RequireAuth()
  async create(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: CreateUserDto,
  ): Promise<CreatedUserDto> {
    return this.createUserUseCase.execute(ctx, body);
  }

  @Post(':id/impersonate')
  @RequireAuth()
  async impersonate(
    @CurrentContext() ctx: AuthenticatedContext,
    @Param('id') id: string,
  ) {
    return this.impersonateUserUseCase.execute(ctx, id);
  }
}
