import type { CSSProperties } from 'react';
import type { TFunction } from 'i18next';
import { ApiError } from '../../shared/api/client';
import { surfaceCardStyle } from '../../shared/ui/surface';

export function getBackendReason(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const key = `customer.reseller.reason.${error.reasonKey}`;
    const translated = t(key);
    return translated === key ? t('customer.reseller.genericActionFailed') : translated;
  }
  if (error instanceof Error && error.message) return t('customer.reseller.genericActionFailed');
  return t('error');
}

export function resellerHeroStyle(extra?: CSSProperties): CSSProperties {
  return surfaceCardStyle({
    border: '1px solid var(--ipx-border, #d8d8d8)',
    boxShadow: 'none',
    background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)',
    overflow: 'hidden',
    ...extra,
  });
}

export function resellerMetricToneStyle(tone: string): CSSProperties {
  return resellerSummaryItemStyle(tone);
}

export const resellerMetricBodyStyle = { body: { padding: 12, minHeight: 78 } };

export function resellerSummaryItemStyle(accent = '#315cff'): CSSProperties {
  return surfaceCardStyle({
    border: '1px solid rgba(0, 58, 254, 0.08)',
    borderLeft: `3px solid ${accent}`,
    boxShadow: 'none',
    background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 5%, #fff) 0%, #ffffff 62%)`,
    minHeight: '100%',
  });
}

export const resellerSummaryStripStyle: CSSProperties = {
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)',
  border: '1px solid rgba(0, 58, 254, 0.08)',
  borderRadius: 'var(--ipx-radius, 8px)',
  padding: 10,
};

export const resellerToolbarStyle: CSSProperties = {
  alignItems: 'center',
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)',
  border: '1px solid rgba(0, 58, 254, 0.09)',
  borderRadius: 'var(--ipx-radius, 8px)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  justifyContent: 'space-between',
  minHeight: 52,
  padding: '10px 12px',
  width: '100%',
};

export const resellerToolbarFiltersStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

export const resellerWorkspaceHeaderStyle: CSSProperties = {
  alignItems: 'flex-start',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'space-between',
  width: '100%',
};

export const resellerIconStyle: CSSProperties = {
  alignItems: 'center',
  background: '#eef3ff',
  border: '1px solid rgba(0, 58, 254, 0.12)',
  borderRadius: 'var(--ipx-radius-btn, 6px)',
  color: 'var(--ipx-primary, #003afe)',
  display: 'inline-flex',
  flex: '0 0 auto',
  height: 36,
  justifyContent: 'center',
  width: 36,
};

export const resellerCompactInputStyle: CSSProperties = {
  width: 220,
};

export const resellerCompactSelectStyle: CSSProperties = {
  width: 150,
};
