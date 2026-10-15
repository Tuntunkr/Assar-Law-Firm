import { ApiClientError } from '@assar/api-client';
import { Alert, Button, TextField } from '@assar/ui';
import { portalLoginSchema } from '@assar/validation';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const FIRM_KEY = 'assar.portal.firm';
type Errors = Partial<Record<'organizationSlug' | 'email' | 'password', string>>;

function messageFor(e: unknown): string {
  if (!(e instanceof ApiClientError)) return 'Something went wrong. Please try again.';
  if (e.status === 401) return 'The firm ID, email or password is not correct.';
  if (e.code === 'ACCOUNT_LOCKED' || e.status === 429)
    return 'Too many attempts. Please wait a few minutes and try again.';
  return e.message;
}

export function LoginPage() {
  const { login, state } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation() as { state?: { from?: string; notice?: string } };
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firm = params.get('firm') ?? localStorage.getItem(FIRM_KEY) ?? '';
  const notice =
    location.state?.notice ?? (state.status === 'anonymous' ? state.notice : undefined);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = portalLoginSchema.safeParse({
      organizationSlug: fd.get('firm'),
      email: fd.get('email'),
      password: fd.get('password'),
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues)
        next[issue.path[0] as keyof Errors] ??=
          issue.path[0] === 'password'
            ? 'Enter your password'
            : issue.path[0] === 'email'
              ? 'Enter a valid email address'
              : 'Enter your firm ID';
      setErrors(next);
      setFailure(null);
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      await login(parsed.data);
      localStorage.setItem(FIRM_KEY, parsed.data.organizationSlug);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setFailure(messageFor(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Client portal</h1>
      <p className="mt-1 text-sm text-navy-700">
        Sign in to see the matters and documents your law firm has shared with you.
      </p>
      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-6 space-y-4 rounded-xl border border-navy-100 bg-white p-6 shadow-sm"
        aria-label="Sign in"
      >
        {notice && <Alert tone="info">{notice}</Alert>}
        {failure && <Alert tone="error">{failure}</Alert>}
        <TextField
          id="firm"
          name="firm"
          label="Firm ID"
          hint="Your law firm gave you this, for example “smith-llp”."
          defaultValue={firm}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          error={errors.organizationSlug}
          required
        />
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          error={errors.email}
          required
        />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          error={errors.password}
          required
        />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-navy-600">
        Have an invitation?{' '}
        <Link className="font-medium text-accent-700 underline" to="/invite">
          Create your account
        </Link>
      </p>
    </div>
  );
}
