import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { LoginUseCase } from './use-cases/login.use-case';
import { LogoutUseCase } from './use-cases/logout.use-case';
import { ChangePasswordUseCase } from './use-cases/change-password.use-case';
import { RegisterUserUseCase } from './use-cases/register-user.use-case';
import {
  CurrentUserDto,
  LoginDto,
  LoginResponseDto,
  ChangePasswordDto,
  RegisterDto,
  RegisterResponseDto,
} from './dto';
import { RequireAuth } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly registerUserUseCase: RegisterUserUseCase,
  ) {}

  @Post('login')
  async login(@Body() body: LoginDto): Promise<LoginResponseDto> {
    return this.loginUseCase.execute(body);
  }

  @Post('register')
  async register(@Body() body: RegisterDto): Promise<RegisterResponseDto> {
    return this.registerUserUseCase.execute(body);
  }

  @Get('me')
  @RequireAuth()
  me(@CurrentContext() ctx: AuthenticatedContext): CurrentUserDto {
    return {
      ownerId: ctx.ownerId,
      ownerType: ctx.ownerType,
      siteId: ctx.siteId,
      tenantId: ctx.tenantId,
      scopes: ctx.scopes,
    };
  }

  @Post('logout')
  @RequireAuth()
  async logout(
    @CurrentContext() ctx: AuthenticatedContext,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const sessionId = (req as unknown as { sessionId?: string }).sessionId ?? '';
    await this.logoutUseCase.execute(ctx, sessionId);
  }

  @Post('change-password')
  @RequireAuth()
  async changePassword(
    @CurrentContext() ctx: AuthenticatedContext,
    @Req() req: FastifyRequest,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    const sessionId = (req as unknown as { sessionId?: string }).sessionId ?? '';
    await this.changePasswordUseCase.execute(ctx, sessionId, body);
  }
}
