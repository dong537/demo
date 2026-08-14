export interface ApiEnvelope<T> {
  code: number | string;
  msg: string;
  data: T;
  requestId: string;
}

interface ApiErrorData {
  reasonKey?: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly code: number | string,
    public readonly reasonKey: string,
    public readonly details?: unknown,
  ) {
    super(reasonKey);
    this.name = 'ApiError';
  }
}

type AuthTokenKey = 'admin_token' | 'user_token';

function getToken(key: AuthTokenKey): string | null {
  return sessionStorage.getItem(key);
}

function isRailwayFrontend(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return /(^|\.)(up\.railway\.app|railway\.app)$/i.test(hostname);
}

function withJsonAuthHeaders(init: RequestInit, token: string | null): RequestInit {
  const explicitHeaders = normalizeHeaders(init.headers);
  const headers: Record<string, string> = {
    ...(hasRequestBody(init) && !hasHeader(explicitHeaders, 'Content-Type') ? { 'Content-Type': 'application/json' } : {}),
    ...explicitHeaders,
  };
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  return { ...init, headers };
}

function hasRequestBody(init: RequestInit): boolean {
  return init.body !== undefined && init.body !== null;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
  if (isRailwayFrontend()) return path.startsWith('/') ? path : `/${path}`;
  if (!baseUrl || baseUrl === '/api') return path;
  return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function publicSiteHeaders(): Record<string, string> {
  if (typeof window === 'undefined' || !window.location.hostname) return {};
  return { 'x-public-host': window.location.host };
}

export async function userApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestEnvelope<T>(path, withJsonAuthHeaders(init, getToken('user_token')));
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestEnvelope<T>(path, withJsonAuthHeaders(init, getToken('admin_token')));
}

async function requestEnvelope<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildApiUrl(path), init);
  } catch {
    throw new ApiError(0, 'network_error');
  }

  let json: ApiEnvelope<T>;
  try {
    json = await res.json() as ApiEnvelope<T>;
  } catch {
    throw new ApiError(res.status, 'network_error');
  }

  if (json.code !== 0) {
    const data = json.data as ApiErrorData | null;
    throw new ApiError(json.code, data?.reasonKey ?? json.msg, data?.details);
  }
  return json.data;
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
