import { ApiClientError, type StaffClient, type StaffMe } from '@assar/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AppRoutes } from '../src/App';
import { NotifyProvider } from '../src/components/notify';
import { AuthProvider } from '../src/lib/auth';
import { SESSION_EXPIRED_EVENT } from '../src/lib/client';

const attorney: StaffMe = {
  user: { id: 'u1', email: 'ann@firm.test', name: 'Ann Attorney' },
  organization: { id: 'o1', name: 'Smith & Co', slug: 'smith-co' },
  role: 'attorney',
  permissions: ['client:read', 'matter:read', 'task:write', 'calendar:write', 'ai:use'],
  mfa: { enabled: false, enrollmentRequired: false },
  csrfToken: 'csrf',
};
const owner: StaffMe = {
  ...attorney,
  role: 'owner',
  permissions: [...attorney.permissions, 'user:manage', 'audit:read'],
  mfa: { enabled: false, enrollmentRequired: true },
};

const err = (status: number, code: ApiClientError['code'], message: string) =>
  new ApiClientError(message, status, code);
type MockClient = { [K in keyof StaffClient]: StaffClient[K] & Mock };

const emptyPage = { data: [], page: { nextCursor: null, limit: 25 } };
function makeClient(over: Partial<Record<keyof StaffClient, unknown>> = {}) {
  const client = {
    me: vi.fn().mockRejectedValue(err(401, 'UNAUTHENTICATED', 'Authentication required')),
    login: vi.fn().mockResolvedValue(attorney),
    logout: vi.fn().mockResolvedValue(undefined),
    members: vi.fn().mockResolvedValue(emptyPage),
    notifications: vi.fn().mockResolvedValue({ ...emptyPage, unread: 0 }),
    tasks: vi.fn().mockResolvedValue(emptyPage),
    events: vi.fn().mockResolvedValue(emptyPage),
    aiOutputs: vi.fn().mockResolvedValue(emptyPage),
    matters: vi.fn().mockResolvedValue(emptyPage),
    clients: vi.fn().mockResolvedValue(emptyPage),
    documents: vi.fn().mockResolvedValue(emptyPage),
    ...over,
  };
  return client as unknown as MockClient;
}

function renderApp(client: MockClient, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={client}>
        <NotifyProvider>
          <AppRoutes />
        </NotifyProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('sign-in', () => {
  let client: MockClient;
  beforeEach(() => {
    client = makeClient();
  });

  it('sends anonymous visitors to the login page', async () => {
    renderApp(client, '/clients');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in and shows the overview', async () => {
    const user = userEvent.setup();
    renderApp(client);
    await user.type(await screen.findByLabelText('Email'), 'ann@firm.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Good (morning|afternoon|evening), Ann/)).toBeInTheDocument();
    expect(client.login).toHaveBeenCalledWith({
      email: 'ann@firm.test',
      password: 'correct horse battery',
    });
  });

  it('asks for the authentication code when the API requires MFA, then retries with it', async () => {
    client.login
      .mockRejectedValueOnce(err(401, 'MFA_REQUIRED', 'Enter your authentication code'))
      .mockResolvedValueOnce(attorney);
    const user = userEvent.setup();
    renderApp(client);
    await user.type(await screen.findByLabelText('Email'), 'ann@firm.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await screen.findByText(/Good (morning|afternoon|evening), Ann/);
    expect(client.login).toHaveBeenLastCalledWith({
      email: 'ann@firm.test',
      password: 'correct horse battery',
      mfaCode: '123456',
    });
  });

  it('shows the API error for wrong credentials and stays on the page', async () => {
    client.login.mockRejectedValue(err(401, 'UNAUTHENTICATED', 'Invalid email or password'));
    const user = userEvent.setup();
    renderApp(client);
    await user.type(await screen.findByLabelText('Email'), 'ann@firm.test');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('login page has no accessibility violations', async () => {
    const { container } = renderApp(client);
    await screen.findByRole('heading', { name: 'Sign in' });
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('sign-up and profile', () => {
  it('creates a firm and sends the new owner to MFA setup', async () => {
    const created = { ...owner, user: { ...owner.user, name: 'Olivia Owner' } };
    const client = makeClient({ register: vi.fn().mockResolvedValue(created) });
    const user = userEvent.setup();
    renderApp(client, '/signup');
    await user.type(await screen.findByLabelText('Firm name'), 'Smith & Co');
    await user.type(screen.getByLabelText('Your name'), 'Olivia Owner');
    await user.type(screen.getByLabelText('Work email'), 'olivia@smith.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByRole('heading', { name: 'Set up multi-factor authentication' }),
    ).toBeInTheDocument();
    expect(client.register).toHaveBeenCalledWith({
      organizationName: 'Smith & Co',
      name: 'Olivia Owner',
      email: 'olivia@smith.test',
      password: 'correct horse battery',
    });
  });

  it('does not call the API when the passwords differ', async () => {
    const client = makeClient({ register: vi.fn() });
    const user = userEvent.setup();
    renderApp(client, '/signup');
    await user.type(await screen.findByLabelText('Firm name'), 'Smith & Co');
    await user.type(screen.getByLabelText('Your name'), 'Olivia Owner');
    await user.type(screen.getByLabelText('Work email'), 'olivia@smith.test');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.type(screen.getByLabelText('Confirm password'), 'something else');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(client.register).not.toHaveBeenCalled();
  });

  it('accepts an invitation from the emailed link', async () => {
    const client = makeClient({ acceptInvitation: vi.fn().mockResolvedValue({ ok: true }) });
    const user = userEvent.setup();
    renderApp(client, '/invite?token=tok_abcdefghijklmnopqrstuvwxyz');
    await user.type(await screen.findByLabelText('Your name'), 'Tess Teammate');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText('Your account is ready.')).toBeInTheDocument();
    expect(client.acceptInvitation).toHaveBeenCalledWith({
      token: 'tok_abcdefghijklmnopqrstuvwxyz',
      name: 'Tess Teammate',
      password: 'correct horse battery',
    });
  });

  it('lets a signed-in user rename themselves and sign out other devices', async () => {
    const session = (id: string, current: boolean) => ({
      id,
      current,
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120 Safari/537',
      createdAt: '2031-01-01T10:00:00.000Z',
      lastSeenAt: '2031-01-01T10:05:00.000Z',
      expiresAt: '2031-01-02T10:00:00.000Z',
    });
    const client = makeClient({
      me: vi.fn().mockResolvedValue(attorney),
      updateProfile: vi
        .fn()
        .mockResolvedValue({ ...attorney, user: { ...attorney.user, name: 'Ann B. Attorney' } }),
      sessions: vi.fn().mockResolvedValue({ data: [session('s1', true), session('s2', false)] }),
      revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
    });
    const user = userEvent.setup();
    renderApp(client, '/profile');
    const name = await screen.findByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Ann B. Attorney');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(client.updateProfile).toHaveBeenCalledWith('Ann B. Attorney'));

    await user.click(screen.getByRole('tab', { name: 'Sessions' }));
    expect(await screen.findByText('this device')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out all other devices' }));
    await waitFor(() => expect(client.revokeOtherSessions).toHaveBeenCalled());
  });
});

describe('signed-in app', () => {
  it('only lists navigation the role has permission for', async () => {
    const client = makeClient({ me: vi.fn().mockResolvedValue(attorney) });
    renderApp(client);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Clients');
    expect(nav).toHaveTextContent('Matters');
    expect(nav).not.toHaveTextContent('Team');
    expect(nav).not.toHaveTextContent('Audit log');
    expect(nav).not.toHaveTextContent('Invoices');
  });

  it('shows a no-access page instead of a page the role cannot use', async () => {
    const client = makeClient({ me: vi.fn().mockResolvedValue(attorney) });
    renderApp(client, '/team');
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    expect(client.members).toHaveBeenCalledTimes(1); // only the shared names lookup, not the Team page
  });

  it('forces owners without MFA to the setup page', async () => {
    const client = makeClient({ me: vi.fn().mockResolvedValue(owner) });
    renderApp(client, '/clients');
    expect(
      await screen.findByRole('heading', { name: 'Set up multi-factor authentication' }),
    ).toBeInTheDocument();
  });

  it('returns to sign-in with an explanation when the session expires', async () => {
    const client = makeClient({ me: vi.fn().mockResolvedValue(attorney) });
    renderApp(client);
    await screen.findByText(/Good (morning|afternoon|evening), Ann/);
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    expect(await screen.findByText(/Your session has ended/)).toBeInTheDocument();
  });

  it('loads a list page and shows the empty state', async () => {
    const client = makeClient({ me: vi.fn().mockResolvedValue(attorney) });
    renderApp(client, '/clients');
    expect(await screen.findByText('No clients found')).toBeInTheDocument();
    await waitFor(() => expect(client.clients).toHaveBeenCalled());
  });
});

describe('matter court details', () => {
  const matter = {
    id: 'm1',
    matterNumber: 'M-2031-00001',
    clientId: 'c1',
    title: 'Lease Dispute',
    practiceArea: 'litigation',
    description: null,
    court: {
      name: 'High Court of Delhi',
      caseNumber: 'CS 12/2031',
      judge: null,
      courtroom: null,
      jurisdiction: null,
      filedOn: '2031-03-04',
    },
    status: 'open',
    restricted: false,
    portalVisible: false,
    portalNote: null,
    leadAttorneyId: null,
    teamIds: [],
    openedAt: '2031-01-05T00:00:00.000Z',
    closedAt: null,
    createdAt: '2031-01-05T00:00:00.000Z',
    updatedAt: '2031-01-05T00:00:00.000Z',
  };
  const writer: StaffMe = { ...attorney, permissions: [...attorney.permissions, 'matter:write'] };

  it('shows the court and the next scheduled hearing', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(attorney),
      matter: vi.fn().mockResolvedValue(matter),
      events: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'e1',
            title: 'Final hearing',
            kind: 'hearing',
            status: 'scheduled',
            startsAt: '2031-06-01T09:00:00.000Z',
            endsAt: null,
            allDay: false,
            location: null,
            description: null,
            matterId: 'm1',
            attendeeIds: [],
          },
        ],
        page: { nextCursor: null, limit: 20 },
      }),
    });
    renderApp(client, '/matters/m1');
    expect(await screen.findByText('High Court of Delhi')).toBeInTheDocument();
    expect(screen.getByText('CS 12/2031')).toBeInTheDocument();
    expect(await screen.findByText(/Final hearing/)).toBeInTheDocument();
    expect(client.events).toHaveBeenCalledWith(
      expect.objectContaining({ matterId: 'm1', kind: 'hearing' }),
    );
  });

  it('saves edited court details, sending only the filled fields', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(writer),
      matter: vi.fn().mockResolvedValue({ ...matter, court: null }),
      events: vi.fn().mockResolvedValue(emptyPage),
      updateMatter: vi.fn().mockResolvedValue(matter),
    });
    const user = userEvent.setup();
    renderApp(client, '/matters/m1');
    await user.click(await screen.findByRole('button', { name: 'Add court details' }));
    await user.type(await screen.findByLabelText('Court'), 'District Court');
    await user.type(screen.getByLabelText('Judge'), 'J. Rao');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.updateMatter).toHaveBeenCalledWith('m1', {
        court: { name: 'District Court', judge: 'J. Rao' },
      }),
    );
  });
});

describe('client documents tab', () => {
  const clientDto = {
    id: 'c1',
    type: 'organization',
    name: 'Acme Holdings',
    email: 'legal@acme.test',
    phone: null,
    address: null,
    status: 'active',
    createdAt: '2031-01-01T00:00:00.000Z',
    updatedAt: '2031-01-01T00:00:00.000Z',
  };
  it("lists documents across all of the client's matters", async () => {
    const reader: StaffMe = {
      ...attorney,
      permissions: [...attorney.permissions, 'document:read'],
    };
    const client = makeClient({
      me: vi.fn().mockResolvedValue(reader),
      client: vi.fn().mockResolvedValue(clientDto),
      matters: vi.fn().mockResolvedValue(emptyPage),
      documentSearch: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'd1',
            matterId: 'm1',
            title: 'Signed Lease',
            latestVersion: 1,
            createdAt: '2031-01-02T00:00:00.000Z',
            updatedAt: '2031-01-02T00:00:00.000Z',
            latest: {
              version: 1,
              filename: 'lease.pdf',
              contentType: 'application/pdf',
              sizeBytes: 2048,
              status: 'clean',
              scanResult: 'clean',
              createdAt: '2031-01-02T00:00:00.000Z',
            },
            matter: {
              id: 'm1',
              matterNumber: 'M-2031-00001',
              title: 'Lease Dispute',
              clientId: 'c1',
            },
          },
        ],
        page: { nextCursor: null, limit: 25 },
      }),
    });
    const user = userEvent.setup();
    renderApp(client, '/clients/c1');
    await user.click(await screen.findByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText('Signed Lease')).toBeInTheDocument();
    expect(screen.getByText('M-2031-00001')).toBeInTheDocument();
    expect(client.documentSearch).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1' }));
  });

  it('hides the Documents tab from roles without document access', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(attorney),
      client: vi.fn().mockResolvedValue(clientDto),
      matters: vi.fn().mockResolvedValue(emptyPage),
    });
    renderApp(client, '/clients/c1');
    await screen.findByRole('tab', { name: 'Overview' });
    expect(screen.queryByRole('tab', { name: 'Documents' })).not.toBeInTheDocument();
  });
});

describe('case timeline', () => {
  const entry = (n: number, type = 'task.created') => ({
    at: `2031-01-${String(30 - n).padStart(2, '0')}T10:00:00.000Z`,
    type,
    title: n === 0 ? 'Matter opened' : `Event ${n}`,
    detail: `Detail ${n}`,
    actorId: null,
    matterId: 'm1',
    ref: null,
  });
  const matterDto = {
    id: 'm1',
    matterNumber: 'M-1',
    clientId: 'c1',
    title: 'Lease Dispute',
    practiceArea: 'litigation',
    description: null,
    court: null,
    status: 'open',
    restricted: false,
    portalVisible: false,
    portalNote: null,
    leadAttorneyId: null,
    teamIds: [],
    openedAt: '2031-01-01T00:00:00.000Z',
    closedAt: null,
    createdAt: '2031-01-01T00:00:00.000Z',
    updatedAt: '2031-01-01T00:00:00.000Z',
  };

  it('shows the matter history and loads older entries on request', async () => {
    const timeline = vi
      .fn()
      .mockResolvedValueOnce({
        data: [entry(0, 'matter.opened'), entry(1)],
        page: { nextBefore: '2031-01-29T10:00:00.000Z', limit: 30 },
      })
      .mockResolvedValueOnce({ data: [entry(2)], page: { nextBefore: null, limit: 30 } });
    const client = makeClient({
      me: vi.fn().mockResolvedValue(attorney),
      matter: vi.fn().mockResolvedValue(matterDto),
      matterTimeline: timeline,
    });
    const user = userEvent.setup();
    renderApp(client, '/matters/m1');
    await user.click(await screen.findByRole('tab', { name: 'Timeline' }));
    expect(await screen.findByText('Matter opened')).toBeInTheDocument();
    expect(screen.getByText('Detail 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('Detail 2')).toBeInTheDocument();
    expect(timeline).toHaveBeenLastCalledWith('m1', {
      limit: 30,
      before: '2031-01-29T10:00:00.000Z',
    });
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
  });

  it('explains an empty history and offers a retry after an error', async () => {
    const timeline = vi
      .fn()
      .mockRejectedValueOnce(err(500, 'INTERNAL', 'Something broke'))
      .mockResolvedValueOnce({ data: [], page: { nextBefore: null, limit: 30 } });
    const client = makeClient({
      me: vi.fn().mockResolvedValue(attorney),
      matter: vi.fn().mockResolvedValue(matterDto),
      matterTimeline: timeline,
    });
    const user = userEvent.setup();
    renderApp(client, '/matters/m1');
    await user.click(await screen.findByRole('tab', { name: 'Timeline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something broke');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No history yet')).toBeInTheDocument();
  });
});

describe('AI client summary and job list', () => {
  const clientDto = {
    id: 'c1',
    type: 'organization',
    name: 'Acme Holdings',
    email: null,
    phone: null,
    address: null,
    status: 'active',
    createdAt: '2031-01-01T00:00:00.000Z',
    updatedAt: '2031-01-01T00:00:00.000Z',
  };
  const job = (over: object = {}) => ({
    id: 'j1',
    matterId: null,
    clientId: 'c1',
    task: 'case_history',
    status: 'queued',
    stage: null,
    attempts: 0,
    maxAttempts: 3,
    error: null,
    outputId: null,
    createdAt: '2031-01-02T00:00:00.000Z',
    finishedAt: null,
    ...over,
  });
  const ai: StaffMe = {
    ...attorney,
    permissions: [...attorney.permissions, 'ai:use', 'matter:read'],
  };

  it('requests a summary and reports the real job progress until it finishes', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(ai),
      client: vi.fn().mockResolvedValue(clientDto),
      matters: vi.fn().mockResolvedValue(emptyPage),
      aiOutputs: vi.fn().mockResolvedValue(emptyPage),
      createClientSummary: vi.fn().mockResolvedValue(job()),
      aiJob: vi.fn().mockResolvedValue(job({ status: 'succeeded', outputId: 'o1' })),
    });
    const user = userEvent.setup();
    renderApp(client, '/clients/c1');
    await user.click(await screen.findByRole('tab', { name: 'AI summary' }));
    expect(screen.getByText(/private to you/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Focus (optional)'), 'what is outstanding?');
    await user.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(client.createClientSummary).toHaveBeenCalledWith({
      clientId: 'c1',
      instructions: 'what is outstanding?',
    });
    expect(await screen.findByText('Waiting for a worker…')).toBeInTheDocument();
    expect(
      await screen.findByText(/Done — open it from the list/, {}, { timeout: 6000 }),
    ).toBeInTheDocument();
  });

  it('shows why a summary failed', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(ai),
      client: vi.fn().mockResolvedValue(clientDto),
      matters: vi.fn().mockResolvedValue(emptyPage),
      aiOutputs: vi.fn().mockResolvedValue(emptyPage),
      createClientSummary: vi.fn().mockResolvedValue(job()),
      aiJob: vi.fn().mockResolvedValue(
        job({
          status: 'failed',
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'There are no visible matters to summarise for this client',
            retryable: false,
          },
        }),
      ),
    });
    const user = userEvent.setup();
    renderApp(client, '/clients/c1');
    await user.click(await screen.findByRole('tab', { name: 'AI summary' }));
    await user.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(
      await screen.findByText(/no visible matters to summarise/, {}, { timeout: 6000 }),
    ).toBeInTheDocument();
  });

  it('hides the AI summary tab without AI permission', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue({ ...attorney, permissions: ['client:read', 'matter:read'] }),
      client: vi.fn().mockResolvedValue(clientDto),
      matters: vi.fn().mockResolvedValue(emptyPage),
    });
    renderApp(client, '/clients/c1');
    await screen.findByRole('tab', { name: 'Overview' });
    expect(screen.queryByRole('tab', { name: 'AI summary' })).not.toBeInTheDocument();
  });

  it('renders a failed job in the Jobs list without crashing', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(ai),
      aiOutputs: vi.fn().mockResolvedValue(emptyPage),
      aiJobs: vi.fn().mockResolvedValue({
        data: [
          job({
            id: 'j9',
            matterId: 'm1',
            clientId: null,
            task: 'summary',
            status: 'failed',
            attempts: 3,
            error: {
              code: 'MODEL_ERROR',
              message: 'The model could not be reached',
              retryable: true,
            },
          }),
        ],
        page: { nextCursor: null, limit: 25 },
      }),
    });
    const user = userEvent.setup();
    renderApp(client, '/ai');
    await user.click(await screen.findByRole('tab', { name: 'Jobs' }));
    expect(await screen.findByText('The model could not be reached')).toBeInTheDocument();
  });
});

describe('reading, searching and comparing document text', () => {
  const reader: StaffMe = {
    ...attorney,
    permissions: [...attorney.permissions, 'document:read', 'document:write'],
  };
  const v = (version: number, text: object | null) => ({
    version,
    filename: `file${version}.png`,
    contentType: 'image/png',
    sizeBytes: 2048,
    status: 'clean',
    scanResult: 'clean',
    createdAt: '2031-01-02T00:00:00.000Z',
    text,
  });
  const item = {
    id: 'd1',
    matterId: 'm1',
    title: 'Scanned notice',
    latestVersion: 2,
    createdAt: '2031-01-02T00:00:00.000Z',
    updatedAt: '2031-01-02T00:00:00.000Z',
    latest: { ...v(2, null), text: undefined },
    matter: { id: 'm1', matterNumber: 'M-2031-00001', title: 'Lease Dispute', clientId: 'c1' },
  };
  const listing = { data: [item], page: { nextCursor: null, limit: 25 } };
  const detail = {
    ...item,
    versions: [
      v(1, {
        status: 'failed',
        method: null,
        pages: null,
        ocrPages: null,
        confidence: null,
        chars: null,
        truncated: false,
        error: { code: 'NO_TEXT_EXTRACTED', message: 'No readable text was found, even with OCR' },
      }),
      v(2, {
        status: 'done',
        method: 'ocr',
        pages: 2,
        ocrPages: 2,
        confidence: 93,
        chars: 400,
        truncated: false,
        error: null,
      }),
    ],
  };

  it('shows how each version was read, lets you read it, and offers to retry a failure', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(reader),
      documentSearch: vi.fn().mockResolvedValue(listing),
      document: vi.fn().mockResolvedValue(detail),
      versionText: vi.fn().mockResolvedValue({
        status: 'done',
        method: 'ocr',
        confidence: 93,
        truncated: false,
        text: 'SETTLEMENT PROPOSAL in two instalments',
        textTruncated: false,
      }),
      extractVersionText: vi.fn().mockResolvedValue({ status: 'pending' }),
    });
    const user = userEvent.setup();
    renderApp(client, '/documents');
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    expect(
      await screen.findByText(/Scanned \(OCR\) · 93% confident · 2 pages/),
    ).toBeInTheDocument();
    expect(screen.getByText('No readable text was found, even with OCR')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View text' }));
    expect(await screen.findByText(/SETTLEMENT PROPOSAL/)).toBeInTheDocument();
    expect(client.versionText).toHaveBeenCalledWith('d1', 2, false);
    await user.keyboard('{Escape}');

    await user.click(await screen.findByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(client.extractVersionText).toHaveBeenCalledWith('d1', 1));
  });

  it('warns when OCR confidence is low', async () => {
    const low = { ...detail, versions: [v(1, { ...detail.versions[1]!.text, confidence: 55 })] };
    const client = makeClient({
      me: vi.fn().mockResolvedValue(reader),
      documentSearch: vi.fn().mockResolvedValue(listing),
      document: vi.fn().mockResolvedValue(low),
      versionText: vi.fn().mockResolvedValue({
        status: 'done',
        method: 'ocr',
        confidence: 55,
        truncated: false,
        text: 'blurry words',
        textTruncated: false,
      }),
    });
    const user = userEvent.setup();
    renderApp(client, '/documents');
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'View text' }));
    expect(await screen.findByText(/hard to read \(55% confidence\)/)).toBeInTheDocument();
  });

  it('lists similar documents with how similar they are', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(reader),
      documentSearch: vi.fn().mockResolvedValue(listing),
      document: vi.fn().mockResolvedValue(detail),
      similarDocuments: vi.fn().mockResolvedValue({
        data: [
          {
            documentId: 'd2',
            title: 'Lease 2026',
            version: 1,
            similarity: 0.62,
            sharedTerms: ['tenant', 'landlord'],
            matter: { id: 'm2', matterNumber: 'M-2', title: 'Other', clientId: 'c1' },
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderApp(client, '/documents');
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Find similar documents' }));
    expect(await screen.findByText('Lease 2026')).toBeInTheDocument();
    expect(screen.getByText('62% similar')).toBeInTheDocument();
    expect(screen.getByText(/shares: tenant, landlord/)).toBeInTheDocument();
  });

  it('searches inside documents and shows the matching passage', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue(reader),
      documentSearch: vi.fn().mockResolvedValue(listing),
      searchDocumentText: vi.fn().mockResolvedValue({
        data: [
          {
            documentId: 'd1',
            title: 'Scanned notice',
            version: 2,
            method: 'ocr',
            snippet: '…tenant shall vacate within thirty days…',
            matter: item.matter,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderApp(client, '/documents');
    await user.click(await screen.findByLabelText(/Search inside documents/));
    await user.type(screen.getByPlaceholderText('Document title…'), 'vacate');
    expect(await screen.findByText(/tenant shall vacate within thirty days/)).toBeInTheDocument();
    expect(screen.getByText('scanned')).toBeInTheDocument();
    await waitFor(() =>
      expect(client.searchDocumentText).toHaveBeenCalledWith(
        'vacate',
        expect.objectContaining({ limit: 15 }),
      ),
    );
  });
});

describe('templates', () => {
  const tmpl = {
    id: 't1',
    name: 'Legal notice',
    category: 'notice',
    description: 'A formal notice.',
    placeholders: ['client.name', 'notice.demand'],
    status: 'active',
    starter: true,
    revision: 1,
    updatedAt: '2031-01-01T00:00:00.000Z',
  };
  const matterRow = {
    id: 'm1',
    matterNumber: 'M-2031-00001',
    clientId: 'c1',
    title: 'Lease Dispute',
    practiceArea: 'litigation',
    description: null,
    court: null,
    status: 'open',
    restricted: false,
    portalVisible: false,
    portalNote: null,
    leadAttorneyId: null,
    teamIds: [],
    openedAt: '2031-01-01T00:00:00.000Z',
    closedAt: null,
    createdAt: '2031-01-01T00:00:00.000Z',
    updatedAt: '2031-01-01T00:00:00.000Z',
  };
  const writer: StaffMe = {
    ...attorney,
    permissions: [...attorney.permissions, 'document:read', 'document:write'],
  };
  const rendered = (text: string, missing: string[]) => ({
    text,
    missing,
    placeholders: [
      {
        key: 'client.name',
        label: 'Client name',
        builtin: true,
        value: 'Acme Holdings',
        missing: false,
      },
      {
        key: 'notice.demand',
        label: null,
        builtin: false,
        value: null,
        missing: missing.includes('notice.demand'),
      },
    ],
  });

  it('lists templates, fills one for a matter, asks for the details it does not know, and refreshes', async () => {
    const renderTemplate = vi
      .fn()
      .mockResolvedValueOnce(
        rendered('To Acme Holdings: [MISSING: notice.demand]', ['notice.demand']),
      )
      .mockResolvedValueOnce(rendered('To Acme Holdings: pay the rent', []));
    const client = makeClient({
      me: vi.fn().mockResolvedValue(writer),
      templates: vi.fn().mockResolvedValue({ data: [tmpl] }),
      matters: vi
        .fn()
        .mockResolvedValue({ data: [matterRow], page: { nextCursor: null, limit: 100 } }),
      renderTemplate,
    });
    const user = userEvent.setup();
    renderApp(client, '/templates');
    expect(await screen.findByText('Legal notice')).toBeInTheDocument();
    expect(screen.getByText(/starter template/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use' }));
    await user.selectOptions(await screen.findByLabelText(/Matter \(fills in/), 'm1');
    await user.click(screen.getByRole('button', { name: 'Fill template' }));

    expect(await screen.findByDisplayValue(/\[MISSING: notice.demand\]/)).toBeInTheDocument();
    expect(screen.getByText('1 blank left to fill')).toBeInTheDocument();
    expect(renderTemplate).toHaveBeenCalledWith('t1', { matterId: 'm1', values: {} });

    await user.type(screen.getByLabelText('notice demand'), 'pay the rent');
    await user.click(screen.getByRole('button', { name: 'Apply details' }));
    expect(await screen.findByDisplayValue('To Acme Holdings: pay the rent')).toBeInTheDocument();
    expect(renderTemplate).toHaveBeenLastCalledWith('t1', {
      matterId: 'm1',
      values: { 'notice.demand': 'pay the rent' },
    });
    expect(screen.getByText('no blanks left')).toBeInTheDocument();
  });

  it('creates a template with the fields typed in', async () => {
    const createTemplate = vi
      .fn()
      .mockResolvedValue({ ...tmpl, id: 't2', body: 'Hello {{client.name}}' });
    const client = makeClient({
      me: vi.fn().mockResolvedValue(writer),
      templates: vi.fn().mockResolvedValue({ data: [] }),
      createTemplate,
    });
    const user = userEvent.setup();
    renderApp(client, '/templates');
    await user.click(await screen.findByRole('button', { name: 'New template' }));
    await user.type(await screen.findByLabelText('Name'), 'Rent reminder');
    await user.click(screen.getByRole('button', { name: 'Client name' })); // inserts {{client.name}}
    expect(screen.getByLabelText('Text')).toHaveValue('{{client.name}}');
    await user.type(screen.getByLabelText('Text'), ' your rent is due');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Rent reminder',
          category: 'letter',
          body: '{{client.name}} your rent is due',
        }),
      ),
    );
  });

  it('hides editing from people who cannot write documents', async () => {
    const client = makeClient({
      me: vi.fn().mockResolvedValue({ ...attorney, permissions: ['document:read', 'client:read'] }),
      templates: vi.fn().mockResolvedValue({ data: [tmpl] }),
    });
    renderApp(client, '/templates');
    await screen.findByText('Legal notice');
    expect(screen.queryByRole('button', { name: 'New template' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use' })).toBeInTheDocument();
  });
});
