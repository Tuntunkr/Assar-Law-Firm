import { ApiClientError, type PortalClient } from '@assar/api-client';
import type { PortalAiOutput, PortalDocument, PortalMatter, PortalMe } from '@assar/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AppRoutes } from '../src/App';
import { NotifyProvider } from '../src/components/notify';
import { AuthProvider } from '../src/lib/auth';
import { SESSION_EXPIRED_EVENT } from '../src/lib/client';

const me: PortalMe = {
  clientUser: { id: 'u1', name: 'Pat Client', email: 'pat@acme.test' },
  client: { id: 'c1', name: 'Acme Holdings' },
  organization: { name: 'Smith & Co', slug: 'smith-co' },
  csrfToken: 'csrf',
};
const matter: PortalMatter = {
  id: 'm1',
  matterNumber: 'M-2031-00001',
  title: 'Lease Dispute',
  practiceArea: 'litigation',
  status: 'open',
  note: 'Hearing next month.',
  openedAt: '2031-01-05T00:00:00.000Z',
  closedAt: null,
};
const doc: PortalDocument = {
  id: 'd1',
  matterId: 'm1',
  title: 'Signed Lease',
  versions: [
    {
      version: 1,
      filename: 'lease.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sharedAt: '2031-01-06T00:00:00.000Z',
    },
  ],
};
const output: PortalAiOutput = {
  id: 'o1',
  matterId: 'm1',
  task: 'summary',
  title: 'Lease summary',
  body: 'The lease runs for twelve months.\n\nRent is due monthly.',
  points: [{ label: 'Key point', text: 'Twelve month term' }],
  label: 'Prepared with AI assistance and reviewed and approved by your legal team.',
  approvedAt: '2031-01-07T00:00:00.000Z',
};

const err = (status: number, code: ApiClientError['code'], message: string) =>
  new ApiClientError(message, status, code);

type MockClient = { [K in keyof PortalClient]: PortalClient[K] & Mock };

function makeClient(over: Partial<Record<keyof PortalClient, unknown>> = {}) {
  const client = {
    login: vi.fn().mockResolvedValue(me),
    acceptInvitation: vi.fn().mockResolvedValue({ ok: true }),
    me: vi.fn().mockResolvedValue(me),
    logout: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
    listMatters: vi.fn().mockResolvedValue({ data: [matter] }),
    getMatter: vi.fn().mockResolvedValue(matter),
    listDocuments: vi.fn().mockResolvedValue({ data: [doc] }),
    downloadLink: vi.fn().mockResolvedValue({
      url: 'https://files.test/x',
      method: 'GET',
      expiresAt: '2031-01-01T00:05:00Z',
      filename: 'lease.pdf',
    }),
    listAiOutputs: vi.fn().mockResolvedValue({ data: [output] }),
    getAiOutput: vi.fn().mockResolvedValue(output),
    ...over,
  };
  return client as unknown as MockClient;
}

function renderApp(client: PortalClient, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider client={client}>
        <NotifyProvider>
          <AppRoutes />
        </NotifyProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function noA11yViolations(container: HTMLElement) {
  // Colour contrast needs real layout/CSS, which jsdom doesn't have, so it is checked separately in a browser.
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

beforeEach(() => localStorage.clear());

describe('sign-in', () => {
  const anonymous = () =>
    makeClient({
      me: vi.fn().mockRejectedValue(err(401, 'UNAUTHENTICATED', 'Authentication required')),
    });

  it('sends signed-out visitors to the sign-in page, wherever they start', async () => {
    renderApp(anonymous(), '/matters/m1');
    expect(await screen.findByRole('heading', { name: 'Client portal' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('validates the form before calling the API, with accessible errors', async () => {
    const client = anonymous();
    renderApp(client, '/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(client.login).not.toHaveBeenCalled();
  });

  it('signs in, remembers the firm ID, and shows the matters', async () => {
    const client = anonymous();
    renderApp(client, '/login?firm=smith-co');
    expect(await screen.findByLabelText('Firm ID')).toHaveValue('smith-co');
    await userEvent.type(screen.getByLabelText('Email'), 'pat@acme.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Your matters' })).toBeInTheDocument();
    expect(client.login).toHaveBeenCalledWith({
      organizationSlug: 'smith-co',
      email: 'pat@acme.test',
      password: 'correct-horse-battery-1',
    });
    expect(localStorage.getItem('assar.portal.firm')).toBe('smith-co');
  });

  it.each([
    [
      err(401, 'UNAUTHENTICATED', 'Invalid firm, email or password'),
      /firm ID, email or password is not correct/,
    ],
    [err(429, 'ACCOUNT_LOCKED', 'Too many failed attempts.'), /Too many attempts/],
    [
      err(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.'),
      /Could not reach the server/,
    ],
  ])('explains a failed sign-in clearly and lets the user try again', async (failure, message) => {
    const client = anonymous();
    client.login.mockRejectedValueOnce(failure);
    renderApp(client, '/login?firm=smith-co');
    await userEvent.type(await screen.findByLabelText('Email'), 'pat@acme.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('shows a busy state while signing in', async () => {
    const client = anonymous();
    let finish!: (m: PortalMe) => void;
    client.login.mockReturnValueOnce(new Promise<PortalMe>((r) => (finish = r)));
    renderApp(client, '/login?firm=smith-co');
    await userEvent.type(await screen.findByLabelText('Email'), 'pat@acme.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    finish(me);
    expect(await screen.findByRole('heading', { name: 'Your matters' })).toBeInTheDocument();
  });

  it('has no automated accessibility violations', async () => {
    const { container } = renderApp(anonymous(), '/login');
    await screen.findByRole('form', { name: 'Sign in' });
    await noA11yViolations(container);
  });
});

describe('matters list', () => {
  it('shows a loading skeleton, then the matters the client was given', async () => {
    let finish!: (v: { data: PortalMatter[] }) => void;
    const client = makeClient({
      listMatters: vi.fn().mockReturnValue(new Promise((r) => (finish = r))),
    });
    renderApp(client);
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
    finish({ data: [matter] });
    const link = await screen.findByRole('link', { name: /Lease Dispute/ });
    expect(link).toHaveAttribute('href', '/matters/m1');
    expect(screen.getByText('Hearing next month.')).toBeInTheDocument();
    expect(screen.getByText(/M-2031-00001 · Litigation · Opened/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument();
  });

  it('explains an empty list instead of showing a blank page', async () => {
    renderApp(makeClient({ listMatters: vi.fn().mockResolvedValue({ data: [] }) }));
    expect(await screen.findByText('No matters have been shared with you yet')).toBeInTheDocument();
  });

  it('shows a retryable error', async () => {
    const listMatters = vi
      .fn()
      .mockRejectedValueOnce(err(502, 'UNKNOWN', 'Something went wrong. Please try again.'))
      .mockResolvedValue({ data: [matter] });
    renderApp(makeClient({ listMatters }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Lease Dispute/ })).toBeInTheDocument();
    expect(listMatters).toHaveBeenCalledTimes(2);
  });

  it('has no automated accessibility violations', async () => {
    const { container } = renderApp(makeClient());
    await screen.findByRole('link', { name: /Lease Dispute/ });
    await noA11yViolations(container);
  });
});

describe('a matter', () => {
  it('shows the firm’s message, shared documents, and reviewed updates with their label', async () => {
    const { container } = renderApp(makeClient(), '/matters/m1');
    expect(await screen.findByRole('heading', { name: 'Lease Dispute' })).toBeInTheDocument();
    expect(screen.getByText(/Message from your legal team/)).toBeInTheDocument();
    const docs = await screen.findByRole('region', { name: 'Documents' });
    expect(within(docs).getByText('Signed Lease')).toBeInTheDocument();
    expect(within(docs).getByText(/2\.0 KB/)).toBeInTheDocument();
    const updates = await screen.findByRole('region', { name: 'Updates from your legal team' });
    expect(within(updates).getByText('The lease runs for twelve months.')).toBeInTheDocument();
    expect(within(updates).getByText('Twelve month term')).toBeInTheDocument();
    expect(
      within(updates).getByText(/reviewed and approved by your legal team/),
    ).toBeInTheDocument();
    await noA11yViolations(container);
  });

  it('downloads a file through a short-lived link, with a busy state and without leaving the page', async () => {
    let finish!: (l: unknown) => void;
    const downloadLink = vi.fn().mockReturnValue(new Promise((r) => (finish = r)));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderApp(makeClient({ downloadLink }), '/matters/m1');
    const button = await screen.findByRole('button', { name: 'Download lease.pdf' });
    await userEvent.click(button);
    expect(downloadLink).toHaveBeenCalledWith('d1', 1);
    expect(button).toBeDisabled();
    finish({
      url: 'https://files.test/signed?sig=abc',
      method: 'GET',
      expiresAt: '2031-01-01T00:05:00Z',
      filename: 'lease.pdf',
    });
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(button).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Lease Dispute' })).toBeInTheDocument(); // still on the matter
    click.mockRestore();
  });

  it('tells the user when a download fails', async () => {
    const downloadLink = vi.fn().mockRejectedValue(err(404, 'NOT_FOUND', 'Not found'));
    renderApp(makeClient({ downloadLink }), '/matters/m1');
    await userEvent.click(await screen.findByRole('button', { name: 'Download lease.pdf' }));
    expect(await screen.findByText('That file is no longer available.')).toBeInTheDocument();
  });

  it('shows a clear message, without a retry button, when the matter is not available', async () => {
    renderApp(
      makeClient({ getMatter: vi.fn().mockRejectedValue(err(404, 'NOT_FOUND', 'Not found')) }),
      '/matters/other',
    );
    expect(await screen.findByText(/could not find that/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('keeps the rest of the page working when one section fails, and retries just that section', async () => {
    const listDocuments = vi
      .fn()
      .mockRejectedValueOnce(err(500, 'INTERNAL', 'Something went wrong.'))
      .mockResolvedValue({ data: [doc] });
    const client = makeClient({ listDocuments });
    renderApp(client, '/matters/m1');
    const docs = await screen.findByRole('region', { name: 'Documents' });
    expect(await within(docs).findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('Twelve month term')).toBeInTheDocument(); // updates still rendered
    await userEvent.click(within(docs).getByRole('button', { name: 'Try again' }));
    expect(await within(docs).findByText('Signed Lease')).toBeInTheDocument();
    expect(client.listAiOutputs).toHaveBeenCalledTimes(1);
  });

  it('shows friendly empty states for documents and updates', async () => {
    renderApp(
      makeClient({
        listDocuments: vi.fn().mockResolvedValue({ data: [] }),
        listAiOutputs: vi.fn().mockResolvedValue({ data: [] }),
      }),
      '/matters/m1',
    );
    expect(await screen.findByText('No documents shared yet')).toBeInTheDocument();
    expect(await screen.findByText('No updates yet')).toBeInTheDocument();
  });
});

describe('session & account', () => {
  it('returns to sign-in with an explanation when the session expires mid-use', async () => {
    renderApp(makeClient(), '/');
    await screen.findByRole('heading', { name: 'Your matters' });
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Your session has ended. Please sign in again.')).toBeInTheDocument();
  });

  it('signs out', async () => {
    const client = makeClient();
    renderApp(client);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(client.logout).toHaveBeenCalled();
  });

  it('moves keyboard focus to the content when navigating', async () => {
    renderApp(makeClient());
    await userEvent.click(await screen.findByRole('link', { name: 'Account' }));
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(screen.getByText('pat@acme.test')).toBeInTheDocument();
  });

  it('validates and submits a password change, announcing success', async () => {
    const client = makeClient();
    renderApp(client, '/account');
    await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Enter your current password')).toBeInTheDocument();
    expect(client.changePassword).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Current password'), 'old-password-1234');
    await userEvent.type(screen.getByLabelText('New password'), 'a-brand-new-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-different-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Your password was changed/)).toBeInTheDocument();
    expect(client.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password-1234',
      newPassword: 'a-brand-new-passphrase',
    });
  });

  it('reports a wrong current password', async () => {
    const client = makeClient({
      changePassword: vi
        .fn()
        .mockRejectedValue(err(403, 'FORBIDDEN', 'Current password is incorrect')),
    });
    renderApp(client, '/account');
    await userEvent.type(await screen.findByLabelText('Current password'), 'old-password-1234');
    await userEvent.type(screen.getByLabelText('New password'), 'a-brand-new-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is not correct.')).toBeInTheDocument();
  });
});

describe('accepting an invitation', () => {
  const anonymous = (over = {}) =>
    makeClient({
      me: vi.fn().mockRejectedValue(err(401, 'UNAUTHENTICATED', 'Authentication required')),
      ...over,
    });

  it('explains a link that has no invitation code', async () => {
    renderApp(anonymous(), '/invite');
    expect(await screen.findByText(/missing its invitation code/)).toBeInTheDocument();
  });

  it('checks the passwords, creates the account once, and points to sign-in', async () => {
    const client = anonymous();
    renderApp(client, '/invite?token=tok-123456789012345678901&firm=smith-co');
    await userEvent.type(await screen.findByLabelText('Your name'), 'Pat Client');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
    expect(client.acceptInvitation).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Choose a password'));
    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Choose a password'), 'a-long-enough-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/Your account is ready/)).toBeInTheDocument();
    expect(client.acceptInvitation).toHaveBeenCalledWith({
      token: 'tok-123456789012345678901',
      name: 'Pat Client',
      password: 'a-long-enough-passphrase',
    });
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/login?firm=smith-co',
    );
  });

  it('reports an expired or used invitation', async () => {
    const client = anonymous({
      acceptInvitation: vi
        .fn()
        .mockRejectedValue(err(404, 'NOT_FOUND', 'Invitation is invalid or expired')),
    });
    renderApp(client, '/invite?token=tok-123456789012345678901');
    await userEvent.type(await screen.findByLabelText('Your name'), 'Pat Client');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'a-long-enough-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/);
  });
});
