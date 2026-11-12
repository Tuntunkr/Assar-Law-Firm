import { ApiClientError, type StaffClient, type StaffMe } from '@assar/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AppRoutes } from '../src/App';
import { NotifyProvider } from '../src/components/notify';
import { AuthProvider } from '../src/lib/auth';

const assistant: StaffMe = {
  user: { id: 'u1', email: 'ann@firm.test', name: 'Ann Attorney' },
  organization: { id: 'o1', name: 'Smith & Co', slug: 'smith-co' },
  role: 'attorney',
  permissions: ['assistant:use'],
  mfa: { enabled: false, enrollmentRequired: false },
  csrfToken: 'csrf',
};

const err = (status: number, code: ApiClientError['code'], message: string) =>
  new ApiClientError(message, status, code);
type MockClient = { [K in keyof StaffClient]: StaffClient[K] & Mock };

const emptyPage = { data: [], page: { nextCursor: null, limit: 25 } };
function makeClient(over: Partial<Record<keyof StaffClient, unknown>> = {}) {
  const client = {
    me: vi.fn().mockResolvedValue(assistant),
    login: vi.fn().mockRejectedValue(err(401, 'UNAUTHENTICATED', 'Authentication required')),
    logout: vi.fn().mockResolvedValue(undefined),
    members: vi.fn().mockResolvedValue(emptyPage),
    notifications: vi.fn().mockResolvedValue({ ...emptyPage, unread: 0 }),
    tasks: vi.fn().mockResolvedValue(emptyPage),
    events: vi.fn().mockResolvedValue(emptyPage),
    aiOutputs: vi.fn().mockResolvedValue(emptyPage),
    matters: vi.fn().mockResolvedValue(emptyPage),
    clients: vi.fn().mockResolvedValue(emptyPage),
    documents: vi.fn().mockResolvedValue(emptyPage),
    assistantThreads: vi.fn().mockResolvedValue({ data: [] }),
    createAssistantThread: vi.fn(),
    assistantThread: vi.fn(),
    sendAssistantMessage: vi.fn(),
    confirmAssistant: vi.fn(),
    ...over,
  };
  return client as unknown as MockClient;
}

function renderApp(client: MockClient, path = '/ask') {
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

const thread = {
  id: 't1',
  title: 'Filing question',
  createdAt: '2031-01-01T10:00:00.000Z',
  updatedAt: '2031-01-01T10:05:00.000Z',
};

describe('Ask Assar', () => {
  let client: MockClient;
  beforeEach(() => {
    client = makeClient();
  });

  it('shows a validation error for an empty message and does not call the client', async () => {
    const user = userEvent.setup();
    renderApp(client);
    await user.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Enter a message.')).toBeInTheDocument();
    expect(client.sendAssistantMessage).not.toHaveBeenCalled();
    expect(client.createAssistantThread).not.toHaveBeenCalled();
  });

  it('renders a refused reply as text, including markup characters', async () => {
    const body =
      'I can only help with this dashboard and the records your role can see. <b>nope</b>';
    client.assistantThreads.mockResolvedValue({ data: [thread] });
    client.assistantThread.mockResolvedValue({
      ...thread,
      messages: [
        {
          id: 'm1',
          threadId: thread.id,
          role: 'assistant',
          body,
          route: 'refuse',
          toolName: null,
          proposal: null,
          createdAt: '2031-01-01T10:06:00.000Z',
        },
      ],
    });
    const user = userEvent.setup();
    const { container } = renderApp(client);
    await user.click(await screen.findByRole('button', { name: /Filing question/ }));
    const message = await screen.findByText((_, el) => {
      return el?.tagName === 'P' && (el.textContent ?? '') === body;
    });
    expect(message).toHaveTextContent(
      'I can only help with this dashboard and the records your role can see.',
    );
    expect(message).toHaveTextContent('<b>nope</b>');
    expect(message.querySelector('b')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('confirms a pending proposal once', async () => {
    const messageId = 'm9';
    client.assistantThreads.mockResolvedValue({
      data: [{ ...thread, id: 't9', title: 'Create a task' }],
    });
    client.assistantThread.mockResolvedValue({
      ...thread,
      id: 't9',
      title: 'Create a task',
      messages: [
        {
          id: messageId,
          threadId: 't9',
          role: 'assistant',
          body: 'I will add a task called "Call the court". Confirm to create it.',
          route: 'action',
          toolName: 'tasks.create',
          proposal: {
            tool: 'tasks.create',
            arguments: { title: 'Call the court' },
            status: 'pending',
          },
          createdAt: '2031-01-01T10:06:00.000Z',
        },
      ],
    });
    client.confirmAssistant.mockResolvedValue({
      id: messageId,
      threadId: 't9',
      role: 'assistant',
      body: 'I will add a task called "Call the court". Confirm to create it.',
      route: 'action',
      toolName: 'tasks.create',
      proposal: {
        tool: 'tasks.create',
        arguments: { title: 'Call the court' },
        status: 'done',
      },
      createdAt: '2031-01-01T10:06:00.000Z',
    });
    const user = userEvent.setup();
    renderApp(client);
    await user.click(await screen.findByRole('button', { name: /Create a task/ }));
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(client.confirmAssistant).toHaveBeenCalledWith('t9', messageId));
    expect(client.confirmAssistant).toHaveBeenCalledTimes(1);
  });
});
