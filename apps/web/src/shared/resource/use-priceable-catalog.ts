import { useEffect, useRef, useState } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';

export interface PriceableCatalogPage<TItem> {
  page: number;
  pageSize: number;
  total: number;
  items: TItem[];
}

export interface PriceableCatalogState<TItem> {
  items: TItem[];
  total: number;
  pageSize: number;
  loadedCount: number;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingRemaining: boolean;
  isError: boolean;
  error: unknown;
  backgroundError: unknown | null;
  refetch: () => Promise<unknown>;
}

interface UsePriceableCatalogOptions<TItem extends { id: string }> {
  queryKey: QueryKey;
  pageSize: number;
  fetchPage: (page: number) => Promise<PriceableCatalogPage<TItem>>;
  enabled?: boolean;
  batchSize?: number;
  maxPages?: number;
}

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_MAX_PAGES = 200;

export function usePriceableCatalog<TItem extends { id: string }>({
  queryKey,
  pageSize,
  fetchPage,
  enabled = true,
  batchSize = DEFAULT_BATCH_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
}: UsePriceableCatalogOptions<TItem>): PriceableCatalogState<TItem> {
  const [items, setItems] = useState<TItem[]>([]);
  const [total, setTotal] = useState(0);
  const [resolvedPageSize, setResolvedPageSize] = useState(pageSize);
  const [backgroundError, setBackgroundError] = useState<unknown | null>(null);
  const [isFetchingRemaining, setIsFetchingRemaining] = useState(false);
  const loadTokenRef = useRef(0);

  const firstPageQuery = useQuery({
    queryKey: [...queryKey, 'page', 1, pageSize],
    queryFn: () => fetchPage(1),
    enabled,
  });
  const resolvedBatchSize = Math.max(1, Math.floor(batchSize));

  useEffect(() => {
    if (!enabled) {
      setIsFetchingRemaining(false);
      return;
    }
    if (!firstPageQuery.data) {
      if (firstPageQuery.isError) {
        setItems([]);
        setTotal(0);
        setResolvedPageSize(pageSize);
        setBackgroundError(null);
        setIsFetchingRemaining(false);
      }
      return;
    }

    const firstPage = firstPageQuery.data;
    const firstPageItems = dedupeById(Array.isArray(firstPage.items) ? firstPage.items : []);
    const normalizedTotal = normalizeTotal(firstPage.total, firstPageItems.length);
    const normalizedPageSize = normalizePageSize(firstPage.pageSize, pageSize);
    const maxPageCount = Math.max(
      1,
      Math.min(Math.ceil(Math.max(normalizedTotal, firstPageItems.length) / normalizedPageSize), maxPages),
    );

    const loadToken = loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;

    setItems(firstPageItems);
    setTotal(normalizedTotal);
    setResolvedPageSize(normalizedPageSize);
    setBackgroundError(null);

    const shouldLoadMore = maxPageCount > 1 && normalizedTotal > firstPageItems.length;
    setIsFetchingRemaining(shouldLoadMore);
    if (!shouldLoadMore || loadTokenRef.current !== loadToken) return;

    let cancelled = false;
    const remainingPages = Array.from(
      { length: Math.max(0, maxPageCount - 1) },
      (_, index) => index + 2,
    );

    const loadRemainingPages = async () => {
      for (let offset = 0; offset < remainingPages.length; offset += resolvedBatchSize) {
        const batchPages = remainingPages.slice(offset, offset + resolvedBatchSize);
        const batchResults = await Promise.allSettled(batchPages.map((pageNumber) => fetchPage(pageNumber)));
        if (cancelled || loadTokenRef.current !== loadToken) return;

        const batchItems: TItem[] = [];
        let shouldStop = false;

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            const pageResult = result.value;
            const pageItems = dedupeById(Array.isArray(pageResult.items) ? pageResult.items : []);
            batchItems.push(...pageItems);
            const returnedPageSize = normalizePageSize(pageResult.pageSize, normalizedPageSize);
            if (pageItems.length < returnedPageSize) {
              shouldStop = true;
            }
            continue;
          }

          setBackgroundError((current: unknown | null) => current ?? result.reason);
        }

        if (batchItems.length > 0) {
          setItems((current) => dedupeById([...current, ...batchItems]));
        }

        if (shouldStop) break;
      }

      if (!cancelled && loadTokenRef.current === loadToken) {
        setIsFetchingRemaining(false);
      }
    };

    void loadRemainingPages();
    return () => {
      cancelled = true;
    };
  }, [enabled, fetchPage, firstPageQuery.data, firstPageQuery.isError, maxPages, pageSize, resolvedBatchSize]);

  return {
    items,
    total,
    pageSize: resolvedPageSize,
    loadedCount: items.length,
    isLoading: firstPageQuery.isLoading,
    isFetching: firstPageQuery.isFetching,
    isFetchingRemaining,
    isError: firstPageQuery.isError,
    error: firstPageQuery.error,
    backgroundError,
    refetch: firstPageQuery.refetch,
  };
}

function dedupeById<TItem extends { id: string }>(items: TItem[]): TItem[] {
  const map = new Map<string, TItem>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

function normalizeTotal(total: number, fallback: number): number {
  return Number.isFinite(total) && total >= 0 ? total : fallback;
}

function normalizePageSize(pageSize: number, fallback: number): number {
  return Number.isFinite(pageSize) && pageSize > 0 ? pageSize : fallback;
}
