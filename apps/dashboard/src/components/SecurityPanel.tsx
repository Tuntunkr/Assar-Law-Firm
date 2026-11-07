import { Alert, Button, Card, Modal, TextField } from '@assar/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useMe } from '../lib/auth';
import { useAction } from '../lib/useAction';

/** Password change and multi-factor authentication controls for the signed-in user. */
export function SecurityPanel() {
  const { client } = useAuth();
  const me = useMe();
  const act = useAction();
  const dis = useAction();
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [d, setD] = useState({ password: '', code: '' });
  const [disabling, setDisabling] = useState(false);
  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="font-semibold text-navy-900">Change password</h2>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act.run(
                () => client.changePassword(f),
                'Password changed. Other sessions were signed out.',
              )
            )
              setF({ currentPassword: '', newPassword: '' });
          }}
        >
          <TextField
            id="cur"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={f.currentPassword}
            onChange={(e) => setF({ ...f, currentPassword: e.target.value })}
            error={act.errors.currentPassword}
            required
          />
          <TextField
            id="new"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters."
            value={f.newPassword}
            onChange={(e) => setF({ ...f, newPassword: e.target.value })}
            error={act.errors.newPassword}
            required
          />
          <Button type="submit" loading={act.busy}>
            Update password
          </Button>
        </form>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold text-navy-900">Multi-factor authentication</h2>
        {me.mfa.enabled ? (
          <>
            <Alert tone="success">MFA is on for your account.</Alert>
            {['owner', 'admin', 'billing'].includes(me.role) ? (
              <p className="text-sm text-navy-600">
                Your role requires MFA, so it cannot be turned off.
              </p>
            ) : (
              <Button variant="secondary" onClick={() => setDisabling(true)}>
                Turn off MFA
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-navy-700">
              Protect your account with a code from an authenticator app.
            </p>
            <Link
              to="/mfa-setup"
              className="inline-flex h-11 items-center rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white hover:bg-accent-700"
            >
              Set up MFA
            </Link>
          </>
        )}
      </Card>
      <Modal open={disabling} onClose={() => setDisabling(false)} title="Turn off MFA">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await dis.run(() => client.mfaDisable(d), 'MFA turned off')) {
              setDisabling(false);
              window.location.reload();
            }
          }}
        >
          <TextField
            id="dpw"
            label="Password"
            type="password"
            value={d.password}
            onChange={(e) => setD({ ...d, password: e.target.value })}
            required
          />
          <TextField
            id="dcode"
            label="Authentication code"
            inputMode="numeric"
            value={d.code}
            onChange={(e) => setD({ ...d, code: e.target.value })}
            error={dis.errors.code}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDisabling(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={dis.busy}>
              Turn off
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
