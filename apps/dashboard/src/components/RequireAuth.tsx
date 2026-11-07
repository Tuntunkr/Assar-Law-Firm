import { Alert, Button, Skeleton } from '@assar/ui';
import type { Permission } from '@assar/types';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function RequireAuth() {
  const { state, retry } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-8" aria-busy="true" aria-label="Loading">
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
  // Owners, admins and billing staff must enroll in MFA before anything else works (the API enforces it too).
  if (state.me.mfa.enrollmentRequired && location.pathname !== '/mfa-setup') {
    return <Navigate to="/mfa-setup" replace />;
  }
  return <Outlet />;
}

/** Hides a page from roles that lack a permission; the API still enforces it independently. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { can } = useAuth();
  if (!can(permission))
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-semibold text-navy-900">You do not have access to this page</h1>
        <p className="mt-2 text-sm text-navy-600">
          Your role does not include this area. Ask an administrator if you need it.
        </p>
      </div>
    );
  return <>{children}</>;
}
