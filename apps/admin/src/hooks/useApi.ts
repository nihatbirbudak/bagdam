import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/* ── Generic fetch hook ── */

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** `path` null ise istek atılmaz. Bileşen ayrılınca istek iptal edilir. */
export function useApi<T>(path: string | null): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  // Render sırasında ref güncellenmez (react-hooks/refs); effect içinde senkronla.
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!pathRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<T>(pathRef.current, { signal });
      if (!signal?.aborted) setData(res);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Beklenmeyen bir hata oluştu');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [path, fetchData]);

  return { data, loading, error, refetch: () => fetchData() };
}

/* ── Mutation hook ── */

interface UseMutationReturn<TBody, TRes> {
  mutate: (body: TBody) => Promise<TRes>;
  loading: boolean;
  error: string | null;
}

export function useMutation<TBody, TRes = unknown>(
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string | (() => string),
): UseMutationReturn<TBody, TRes> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (body: TBody) => {
      setLoading(true);
      setError(null);
      try {
        const url = typeof path === 'function' ? path() : path;
        const res = await (method === 'delete' ? api.delete<TRes>(url) : api[method]<TRes>(url, body));
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Beklenmeyen bir hata oluştu';
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [method, path],
  );

  return { mutate, loading, error };
}
