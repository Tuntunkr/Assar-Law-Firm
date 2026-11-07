import { Alert, Button, Card, TextField } from '@assar/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useMe } from '../lib/auth';
import { useAction } from '../lib/useAction';

/** Forced enrollment for roles that require MFA; also reachable from Settings. */
export function MfaSetupPage() {
  const { client, refresh } = useAuth();
  const me = useMe();
  const navigate = useNavigate();
  const setup = useAction();
  const enable = useAction();
  const [secret, setSecret] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  if (me.mfa.enabled && !recovery)
    return (
      <div className="mx-auto max-w-lg">
        <Alert tone="success">
          Multi-factor authentication is already enabled on your account.
        </Alert>
      </div>
    );

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold text-navy-900">Set up multi-factor authentication</h1>
      {me.mfa.enrollmentRequired && (
        <Alert tone="info">
          Your role requires multi-factor authentication. Finish setup to continue using the
          dashboard.
        </Alert>
      )}
      {recovery ? (
        <Card className="space-y-4">
          <Alert tone="success">
            MFA is on. Save these recovery codes now — they are shown once.
          </Alert>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
            {recovery.map((c) => (
              <li key={c} className="rounded bg-navy-50 px-3 py-2">
                {c}
              </li>
            ))}
          </ul>
          <p className="text-xs text-navy-600">
            Each code works once if you lose your device. Other sessions were signed out.
          </p>
          <Button
            onClick={async () => {
              await refresh();
              navigate('/', { replace: true });
            }}
          >
            I have saved them — continue
          </Button>
        </Card>
      ) : !secret ? (
        <Card className="space-y-3">
          <p className="text-sm text-navy-700">
            You will need an authenticator app such as 1Password, Authy or Google Authenticator.
          </p>
          <Button
            loading={setup.busy}
            onClick={async () => setSecret((await setup.run(() => client.mfaSetup())) ?? null)}
          >
            Begin setup
          </Button>
        </Card>
      ) : (
        <Card className="space-y-4">
          <p className="text-sm text-navy-700">
            Add this account to your authenticator app using the setup key, then enter the 6-digit
            code it shows.
          </p>
          <div>
            <p className="text-xs font-medium text-navy-600">Setup key</p>
            <p className="mt-1 break-all rounded bg-navy-50 px-3 py-2 font-mono text-sm">
              {secret.secret}
            </p>
            <a
              className="mt-1 inline-block text-xs text-accent-700 hover:underline"
              href={secret.otpauthUri}
            >
              Open in authenticator app
            </a>
          </div>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await enable.run(() => client.mfaEnable(code.trim()));
              if (r) setRecovery(r.recoveryCodes);
            }}
          >
            <TextField
              id="code"
              label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={enable.errors.code}
              required
            />
            <Button type="submit" loading={enable.busy}>
              Turn on MFA
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
