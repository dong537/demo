import React from 'react';
import { Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { buildApiUrl, publicSiteHeaders } from '../../shared/api/client';
import { formatBrandName } from '../../shared/site/brand-display';
import './auth.css';

interface BrandConfig {
  name?: string;
  siteName?: string;
  logoUrl?: string;
  primaryColor?: string;
}

interface PublicSite {
  name?: string;
  brandConfig?: BrandConfig | null;
}

interface PublicTenant {
  name?: string;
  brandConfig?: BrandConfig | null;
}

interface ApiEnvelope<T> {
  code: number | string;
  msg: string;
  data?: T;
}

interface AuthShellProps {
  title: string;
  subtitle: string;
  serverError?: string | null;
  footer?: React.ReactNode;
  variant?: 'customer' | 'admin';
  children: React.ReactNode;
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function AuthShell({ title, subtitle, serverError, footer, variant = 'customer', children }: AuthShellProps) {
  const { t } = useTranslation();
  const [brand, setBrand] = React.useState<BrandConfig>({});
  const [brandError, setBrandError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof fetch !== 'function') {
      setBrandError('network_error');
      return;
    }
    let cancelled = false;

    void fetch(buildApiUrl('/api/sites/current'), { headers: publicSiteHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error(`site_${response.status}`);
        const json = (await response.json()) as ApiEnvelope<{ site?: PublicSite | null; tenant?: PublicTenant | null }>;
        if (json.code !== 0) throw new Error(json.msg || 'site_failed');
        return json.data ?? null;
      })
      .then((current) => {
        if (cancelled) return;
        if (!current?.site) {
          setBrand({});
          setBrandError(null);
          return;
        }
        const siteBrand = current.site.brandConfig ?? {};
        const tenantBrand = current.tenant?.brandConfig ?? {};
        setBrand({
          ...siteBrand,
          ...tenantBrand,
          name: formatBrandName(tenantBrand.name || tenantBrand.siteName || current.tenant?.name || siteBrand.name || current.site.name),
        });
        setBrandError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBrand({});
        setBrandError(error instanceof Error ? error.message : 'site_failed');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const brandName = formatBrandName(brand.name) || t('public.common.currentSite');
  const primaryColor = brand.primaryColor && HEX_COLOR.test(brand.primaryColor) ? brand.primaryColor : undefined;
  const pageStyle = primaryColor
    ? ({ ['--auth-primary' as string]: primaryColor } as React.CSSProperties)
    : undefined;

  const points = [
    t('customer.auth.points.residential'),
    t('customer.auth.points.coverage'),
    t('customer.auth.points.support'),
  ];

  const logoSrc = brand.logoUrl || '/images/logo.svg';

  return (
    <div className="auth-page" style={pageStyle}>
      <div className="auth-visual auth-visual-airplane" aria-hidden="true" />
      <div className="auth-visual auth-visual-modem" aria-hidden="true" />
      <div className="auth-visual auth-visual-star" aria-hidden="true" />
      <div className="auth-shell">
        <a className="auth-brand-home" href="/" aria-label={brandName}>
          <span className="auth-brand-mark" aria-hidden="true">
            <img src={logoSrc} alt="" />
          </span>
        </a>

        <section className="auth-form-panel">
          <div className="auth-form-head">
            <span className="auth-kicker">{brandName}</span>
            <span className="auth-portal-label">
              {variant === 'admin' ? t('login.title') : t('customer.login.title')}
            </span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {brandError ? (
            <Alert
              type="warning"
              message={t('customer.auth.siteConfigError')}
              description={t('public.common.siteErrorDetail')}
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : null}
          {serverError && <Alert type="error" message={serverError} style={{ marginBottom: 16 }} />}
          {children}
          {footer && <div className="auth-footer-link">{footer}</div>}
        </section>

        <aside className="auth-brand" aria-label={t('customer.auth.previewLabel')}>
          <div className="auth-brand-body">
            <h2>{t('customer.auth.tagline')}</h2>
            <p>{t('customer.auth.brandIntro')}</p>
            <div className="auth-preview-card">
              <div className="auth-preview-head">
                <span>{t('customer.auth.previewTitle')}</span>
                <strong>{brandName}</strong>
              </div>
              <div className="auth-preview-list">
                {points.map((point, index) => (
                  <div key={point}>
                    <strong>{String(index + 1).padStart(2, '0')}</strong>
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>
            <ul className="auth-brand-points">
              {points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
