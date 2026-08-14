import { Controller, Get, Put, Post, Delete, Param, Body, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { RequirePlatformAdmin } from '../../common/auth/guards';
import { CurrentContext } from '../../common/auth/current-context.decorator';
import { AuthenticatedContext } from '../../common/auth/auth-context';
import { PublicSiteContext, SitesRepository } from './sites.repository';
import { UpdateSiteDomainDto } from './dto';
import { UpdateSiteDomainUseCase } from './update-site-domain.use-case';

async function resolvePublicContext(req: FastifyRequest, repo: SitesRepository): Promise<PublicSiteContext> {
  if (req.authContext?.siteId) {
    return { siteId: req.authContext.siteId, tenant: null };
  }
  const forwardedHost = firstHeaderValue(req.headers['x-public-host']);
  const host = forwardedHost ?? firstHeaderValue(req.headers.host) ?? null;
  return repo.resolvePublicContext(host);
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

@Controller('sites')
export class SitesController {
  constructor(
    private readonly repo: SitesRepository,
    private readonly updateSiteDomain: UpdateSiteDomainUseCase,
  ) {}

  @Get('current')
  async getCurrent(@Req() req: FastifyRequest) {
    const context = await resolvePublicContext(req, this.repo);
    const [site, announcements] = await Promise.all([
      this.repo.findById(context.siteId),
      this.repo.listAnnouncements(context.siteId),
    ]);
    return { site, tenant: context.tenant, announcements };
  }

  @Put('current/brand')
  @RequirePlatformAdmin()
  async updateBrand(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: Record<string, unknown>,
  ) {
    return this.repo.updateBrandConfig(ctx.siteId, body);
  }

  @Put('current/domain')
  @RequirePlatformAdmin()
  async updateDomain(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: UpdateSiteDomainDto,
  ) {
    return this.updateSiteDomain.execute(ctx, body);
  }

  @Put('current/maintenance')
  @RequirePlatformAdmin()
  async setMaintenance(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: { enabled: boolean; message?: string },
  ) {
    return this.repo.setMaintenanceMode(ctx.siteId, body.enabled, body.message);
  }

  @Get('current/announcements')
  async listAnnouncements(@Req() req: FastifyRequest) {
    const context = await resolvePublicContext(req, this.repo);
    return this.repo.listAnnouncements(context.siteId);
  }

  @Post('current/announcements')
  @RequirePlatformAdmin()
  async createAnnouncement(
    @CurrentContext() ctx: AuthenticatedContext,
    @Body() body: { title: string; content: string; startsAt?: string; endsAt?: string },
  ) {
    return this.repo.createAnnouncement(ctx.siteId, {
      title: body.title,
      content: body.content,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
    });
  }

  @Put('current/announcements/:id')
  @RequirePlatformAdmin()
  async updateAnnouncement(
    @Param('id') id: string,
    @Body() body: { title?: string; content?: string; startsAt?: string | null; endsAt?: string | null },
  ) {
    return this.repo.updateAnnouncement(id, {
      title: body.title,
      content: body.content,
      startsAt: body.startsAt != null ? new Date(body.startsAt) : body.startsAt === null ? null : undefined,
      endsAt: body.endsAt != null ? new Date(body.endsAt) : body.endsAt === null ? null : undefined,
    });
  }

  @Delete('current/announcements/:id')
  @RequirePlatformAdmin()
  async deactivateAnnouncement(@Param('id') id: string) {
    return this.repo.deactivateAnnouncement(id);
  }
}
