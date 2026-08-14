import type React from 'react';

export function surfaceCardStyle(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    border: '1px solid var(--ipx-border, #d8d8d8)',
    borderRadius: 'var(--ipx-radius, 8px)',
    boxShadow: 'none',
    background: '#ffffff',
    ...extra,
  };
}

export function kpiCardStyle(accent = 'var(--ipx-primary, #315cff)'): React.CSSProperties {
  return surfaceCardStyle({
    minHeight: '100%',
    overflow: 'hidden',
    background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 4%, #fff) 0%, #ffffff 52%)`,
  });
}
