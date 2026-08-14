export class PageQueryDto {
  page?: number = 1;
  pageSize?: number = 20;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  status?: string;
  from?: string;
  to?: string;
}

export interface PageResult<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_DISPLAY_PAGE_SIZE = 20;

export function normalizePageQuery(
  query: Pick<PageQueryDto, 'page' | 'pageSize'> = {},
  options: { maxPageSize?: number } = {},
): { page: number; pageSize: number } {
  const maxPageSize = options.maxPageSize ?? MAX_DISPLAY_PAGE_SIZE;
  const page = normalizePositiveInteger(query.page, 1);
  const pageSize = Math.min(maxPageSize, normalizePositiveInteger(query.pageSize, DEFAULT_PAGE_SIZE));
  return { page, pageSize };
}

function normalizePositiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}
