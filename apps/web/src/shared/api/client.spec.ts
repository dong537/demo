import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError, buildApiUrl, publicSiteHeaders } from './client';

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('keeps backend reasonKey and details when envelope code is not zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 403,
      json: async () => ({
        code: 'PERMISSION_DENIED',
        msg: 'insufficient_permissions',
        data: { reasonKey: 'insufficient_permissions', details: { scope: 'admin' } },
        requestId: 'req-1',
      }),
    })));

    await expect(apiRequest('/api/users')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      reasonKey: 'insufficient_permissions',
      details: { scope: 'admin' },
    } satisfies Partial<ApiError>);
  });

  it('adds bearer token from sessionStorage', async () => {
    sessionStorage.setItem('admin_token', 'token-1');
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ code: 0, msg: 'success', data: { ok: true }, requestId: 'req-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/users')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/users', {
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  it('keeps an explicit authorization header over the session token', async () => {
    sessionStorage.setItem('admin_token', 'old-token');
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ code: 0, msg: 'success', data: { ok: true }, requestId: 'req-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/auth/me', {
      headers: { Authorization: 'Bearer new-token' },
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      headers: { Authorization: 'Bearer new-token' },
    });
  });

  it('adds json content type only when the request has a body', async () => {
    sessionStorage.setItem('admin_token', 'token-1');
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ code: 0, msg: 'success', data: { ok: true }, requestId: 'req-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/providers/pa-1/health-check', { method: 'POST' })).resolves.toEqual({ ok: true });
    await expect(apiRequest('/api/providers', { method: 'POST', body: JSON.stringify({ providerCode: 'IPIPD' }) })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/providers/pa-1/health-check', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-1' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/providers', {
      method: 'POST',
      body: JSON.stringify({ providerCode: 'IPIPD' }),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
    });
  });

  it('normalizes fetch failures to ApiError network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('failed to fetch');
    }));

    await expect(apiRequest('/api/users')).rejects.toMatchObject({
      code: 0,
      reasonKey: 'network_error',
    } satisfies Partial<ApiError>);
  });

  it('uses VITE_API_BASE_URL when frontend and backend have different origins', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com');

    expect(buildApiUrl('/api/users')).toBe('https://backend.example.com/api/users');
  });

  it('uses same-origin API paths when the frontend runs on Railway', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubGlobal('window', {
      location: { hostname: 'frontend-production-1870.up.railway.app', host: 'frontend-production-1870.up.railway.app' },
    } as Window);

    expect(buildApiUrl('/api/users')).toBe('/api/users');
  });

  it('keeps an explicit absolute API base URL on non-Railway hosts', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com');
    vi.stubGlobal('window', {
      location: { hostname: 'localhost', host: 'localhost:3000' },
    } as Window);

    expect(buildApiUrl('/api/users')).toBe('https://backend.example.com/api/users');
  });

  it('builds a public host header for tenant domain resolution', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'localhost', host: 'localhost:3000' },
    } as Window);

    expect(publicSiteHeaders()).toEqual({ 'x-public-host': 'localhost:3000' });
  });
});
