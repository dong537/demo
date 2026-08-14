import { Injectable } from '@nestjs/common';
import { prisma } from '@ipeasy/db';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

interface BrandConfig {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  supportEmail?: string;
  siteUrl?: string;
  apiUrl?: string;
  adminBasePath?: string;
  footerText?: string;
}

export interface PublicSiteContext {
  siteId: string;
  tenant: {
    id: string;
    name: string;
    brandConfig: unknown;
  } | null;
}

@Injectable()
export class SitesRepository {
  async resolvePublicContext(host: string | null): Promise<PublicSiteContext> {
    const normalizedHost = normalizePublicHost(host);
    if (normalizedHost) {
      const directSite = await prisma.sites.findFirst({
        where: { domain: normalizedHost, status: { not: 'DISABLED' } },
        select: { id: true },
      });
      if (directSite) return { siteId: directSite.id, tenant: null };

      const tenant = await prisma.tenants.findFirst({
        where: {
          status: 'ACTIVE',
          brandConfig: { path: ['customDomain'], equals: normalizedHost },
          site: { status: { not: 'DISABLED' } },
        },
        select: {
          id: true,
          name: true,
          brandConfig: true,
          siteId: true,
        },
      });
      if (tenant) {
        return {
          siteId: tenant.siteId,
          tenant: { id: tenant.id, name: tenant.name, brandConfig: tenant.brandConfig },
        };
      }
    }

    const fallbackSite = await prisma.sites.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!fallbackSite) throw new AppError(ErrorCode.NOT_FOUND, 'site_not_found', 404);
    return { siteId: fallbackSite.id, tenant: null };
  }

  async findById(siteId: string) {
    const site = await prisma.sites.findUnique({ where: { id: siteId } });
    if (!site) throw new AppError(ErrorCode.NOT_FOUND, 'site_not_found', 404);
    return site;
  }

  async updateBrandConfig(siteId: string, config: BrandConfig) {
    const site = await this.findById(siteId);
    const merged = { ...(site.brandConfig as object | null ?? {}), ...config };
    return prisma.sites.update({ where: { id: siteId }, data: { brandConfig: merged } });
  }

  async setMaintenanceMode(siteId: string, enabled: boolean, message?: string) {
    await this.findById(siteId);
    return prisma.sites.update({
      where: { id: siteId },
      data: { maintenanceMode: enabled, maintenanceMessage: message ?? null },
    });
  }

  async listAnnouncements(siteId: string) {
    const now = new Date();
    return prisma.site_announcements.findMany({
      where: {
        siteId,
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAnnouncement(siteId: string, data: { title: string; content: string; startsAt?: Date; endsAt?: Date }) {
    return prisma.site_announcements.create({ data: { siteId, ...data } });
  }

  async updateAnnouncement(id: string, data: { title?: string; content?: string; startsAt?: Date | null; endsAt?: Date | null }) {
    return prisma.site_announcements.update({ where: { id }, data });
  }

  async deactivateAnnouncement(id: string) {
    return prisma.site_announcements.update({ where: { id }, data: { isActive: false } });
  }
}

function normalizePublicHost(host: string | null): string | null {
  const value = typeof host === 'string' ? host.trim().toLowerCase() : '';
  if (!value) return null;
  const withoutProtocol = value.replace(/^https?:\/\//, '');
  const withoutPath = withoutProtocol.split('/')[0] ?? '';
  const withoutPort = withoutPath.split(':')[0] ?? '';
  return withoutPort || null;
}
