import { ApiClientError } from '@assar/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiClientError };

/** Loads data when `deps` change; `reload` retries. Results from a superseded request are ignored. */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    loadRef.current().then(
      (data) => current && setState({ status: 'ready', data }),
      (e: unknown) =>
        current &&
        setState({
          status: 'error',
          error:
            e instanceof ApiClientError
              ? e
              : new ApiClientError('Something went wrong. Please try again.', 0, 'UNKNOWN'),
        }),
    );
    return () => {
      current = false;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
