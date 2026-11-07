import { Alert, Button } from '@assar/ui';
import type { ReactNode } from 'react';
import type { AsyncState } from '../lib/useAsync';

/** Shows a skeleton while loading, a retryable error, an empty state, or the content. */
export function AsyncView<T>({
  state,
  onRetry,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  state: AsyncState<T>;
  onRetry: () => void;
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading')
    return (
      <div aria-busy="true" aria-label="Loading">
        {skeleton}
      </div>
    );
  if (state.status === 'error') {
    return (
      <div className="space-y-3">
        <Alert tone="error">
          {state.error.status === 404
            ? 'We could not find that, or you do not have access to it.'
            : state.error.message}
        </Alert>
        {state.error.status !== 404 && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  if (isEmpty?.(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-navy-200 bg-white p-8 text-center">
      <p className="font-medium text-navy-900">{title}</p>
      {children && <p className="mt-1 text-sm text-navy-600">{children}</p>}
    </div>
  );
}
