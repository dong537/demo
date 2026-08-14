import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../users.repository';
import { AuthenticatedContext } from '../../../common/auth/auth-context';
import { requireSelfUser } from '../access';
import { UserProfileDto } from '../dto';

@Injectable()
export class GetMeUseCase {
  constructor(private readonly repo: UsersRepository) {}

  async execute(ctx: AuthenticatedContext): Promise<UserProfileDto> {
    const owner = requireSelfUser(ctx);
    return this.repo.getSelfProfile(owner);
  }
}
