import { ApiClientError } from '@assar/api-client';
import type { Page } from '@assar/types';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Cursor pagination: loads the first page when `deps` change and appends more on `more()`. */
export function usePaged<T>(load: (cursor?: string) => Promise<Page<T>>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'more'>('loading');
  const [error, setError] = useState<ApiClientError | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setStatus('loading');
    loadRef.current().then(
      (p) => {
        if (!live) return;
        setItems(p.data);
        setCursor(p.page.nextCursor);
        setStatus('ready');
      },
      (e: unknown) => {
        if (!live) return;
        setError(
          e instanceof ApiClientError
            ? e
            : new ApiClientError('Something went wrong.', 0, 'UNKNOWN'),
        );
        setStatus('error');
      },
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);

  const more = useCallback(async () => {
    if (!cursor) return;
    setStatus('more');
    try {
      const p = await loadRef.current(cursor);
      setItems((x) => [...x, ...p.data]);
      setCursor(p.page.nextCursor);
      setStatus('ready');
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e : new ApiClientError('Something went wrong.', 0, 'UNKNOWN'),
      );
      setStatus('error');
    }
  }, [cursor]);

  return { items, status, error, hasMore: !!cursor, more, reload: () => setTick((n) => n + 1) };
}
