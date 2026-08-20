import { useCallback, useEffect, useRef, useState } from 'react';
import { api, buildQuery, errorMessage } from '../lib/api';
import type { Paginated } from '../lib/apiTypes';

export type ListParams = Record<string, string | number | boolean | null | undefined>;

interface UsePaginatedListReturn<T> {
  items: T[];
  total: number;
  loading: boolean;
  error: string | null;
  /** Yeniden yükle (aynı parametrelerle). */
  reload: () => Promise<void>;
  /** Yerel güncelleme (satır içi mutasyon sonrası listeyi yeniden çekmeden). */
  setItems: (updater: (prev: T[]) => T[]) => void;
  /** `folders` gibi ek zarf alanları. */
  extra: Record<string, unknown>;
}

/**
 * Sayfalı liste ucu (`{ items, total, page, limit, … }`) için veri kancası.
 * `params` değişince yeniden çeker; bileşen ayrılınca isteği iptal eder.
 */
export function usePaginatedList<T>(basePath: string, params: ListParams): UsePaginatedListReturn<T> {
  const [items, setItemsState] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = buildQuery(params);
  const latestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    latestRef.current?.abort();
    const controller = new AbortController();
    latestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Paginated<T> & Record<string, unknown>>(`${basePath}${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setItemsState(Array.isArray(res?.items) ? res.items : []);
      setTotal(typeof res?.total === 'number' ? res.total : 0);
      const { items: _i, total: _t, page: _p, limit: _l, ...rest } = res ?? ({} as Record<string, unknown>);
      setExtra(rest);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (!controller.signal.aborted) setError(errorMessage(e, 'Liste yüklenemedi'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [basePath, query]);

  useEffect(() => {
    load();
    return () => latestRef.current?.abort();
  }, [load]);

  const setItems = useCallback((updater: (prev: T[]) => T[]) => setItemsState((prev) => updater(prev)), []);

  return { items, total, loading, error, reload: load, setItems, extra };
}
