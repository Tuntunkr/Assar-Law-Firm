import { Alert, Button, Skeleton } from '@assar/ui';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function RequireAuth() {
  const { state, retry } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div
        className="mx-auto max-w-5xl space-y-4 p-8"
        aria-busy="true"
        aria-label="Loading your portal"
      >
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-md space-y-3 p-8">
        <Alert tone="error">{state.message}</Alert>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (state.status === 'anonymous') {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname, notice: state.notice }} />
    );
  }
  return <Outlet />;
}
