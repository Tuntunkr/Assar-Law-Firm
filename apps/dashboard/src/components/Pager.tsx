import { Alert, Button, Skeleton } from '@assar/ui';
import type { ReactNode } from 'react';
import { errorText } from '../lib/useAction';
import type { usePaged } from '../lib/usePaged';

/** Renders a usePaged() list: skeleton, error with retry, empty state, content and "Load more". */
export function PagedView<T>({
  paged,
  empty,
  children,
}: {
  paged: ReturnType<typeof usePaged<T>>;
  empty: ReactNode;
  children: (items: T[]) => ReactNode;
}) {
  if (paged.status === 'loading')
    return (
      <div aria-busy="true" aria-label="Loading" className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  if (paged.status === 'error' && paged.items.length === 0)
    return (
      <div className="space-y-3">
        <Alert tone="error">{errorText(paged.error)}</Alert>
        <Button variant="secondary" onClick={paged.reload}>
          Try again
        </Button>
      </div>
    );
  if (paged.items.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-3">
      {children(paged.items)}
      {paged.hasMore && (
        <div className="text-center">
          <Button variant="secondary" loading={paged.status === 'more'} onClick={paged.more}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
