import {
  ApiClientError,
  type AssistantMessageDto,
  type AssistantThreadDto,
} from '@assar/api-client';
import { Button, cn, TextAreaField } from '@assar/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { EmptyState } from './AsyncView';

const LIMIT = 2000;

const apiError = (e: unknown) =>
  e instanceof ApiClientError ? e.message : 'Something went wrong. Please try again.';

/** Dashboard chat. Cancel only hides the proposal buttons; there is no cancel endpoint. */
export function AskPanel() {
  const { client } = useAuth();
  const [threads, setThreads] = useState<AssistantThreadDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageDto[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const requestId = useRef(0);
  const sending = useRef(false);
  const confirming = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    client.assistantThreads().then(
      (page) => {
        if (!live) return;
        setThreads(page.data);
      },
      (e: unknown) => {
        if (!live) return;
        setThreads([]);
        setListError(apiError(e));
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  function choose(id: string | null) {
    activeRef.current = id;
    setActiveId(id);
  }

  async function openThread(id: string) {
    const request = ++requestId.current;
    choose(id);
    setMessages([]);
    setDismissed(new Set());
    setError(null);
    setLoadingThread(true);
    try {
      const detail = await client.assistantThread(id);
      if (request !== requestId.current) return;
      setMessages(detail.messages);
    } catch (e) {
      if (request !== requestId.current) return;
      setError(apiError(e));
    } finally {
      if (request === requestId.current) setLoadingThread(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) {
      setError('Enter a message.');
      return;
    }
    if (sending.current) return;
    sending.current = true;
    const request = ++requestId.current;
    setError(null);
    setBusy(true);
    setLoadingThread(false);
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: AssistantMessageDto = {
      id: optimisticId,
      threadId: activeRef.current ?? '',
      role: 'user',
      body,
      route: null,
      toolName: null,
      proposal: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    let threadId = activeRef.current;
    try {
      if (!threadId) {
        const created = await client.createAssistantThread({ title: body.slice(0, 200) });
        threadId = created.id;
        if (request !== requestId.current) return;
        choose(created.id);
        setThreads((prev) => [created, ...(prev ?? []).filter((t) => t.id !== created.id)]);
      }
      const reply = await client.sendAssistantMessage(threadId, body);
      if (request !== requestId.current || activeRef.current !== threadId) return;
      setMessages((prev) => (prev.some((m) => m.id === reply.id) ? prev : [...prev, reply]));
    } catch (e) {
      if (request !== requestId.current || activeRef.current !== threadId) return;
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(body);
      setError(apiError(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function confirm(messageId: string) {
    const threadId = activeRef.current;
    if (!threadId || confirming.current.has(messageId)) return;
    confirming.current.add(messageId);
    setConfirmingId(messageId);
    try {
      const updated = await client.confirmAssistant(threadId, messageId);
      if (activeRef.current !== threadId) return;
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } catch (e) {
      if (activeRef.current === threadId) setError(apiError(e));
    } finally {
      confirming.current.delete(messageId);
      setConfirmingId((current) => (current === messageId ? null : current));
    }
  }

  function cancel(messageId: string) {
    setDismissed((prev) => new Set(prev).add(messageId));
  }

  const showEmpty = !loadingThread && messages.length === 0;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <section aria-label="Conversations" className="rounded-xl border border-navy-100 bg-white">
        <h2 className="border-b border-navy-100 px-4 py-3 text-sm font-semibold text-navy-900">
          Conversations
        </h2>
        {listError && (
          <p className="px-4 py-3 text-sm text-red-700" role="alert">
            {listError}
          </p>
        )}
        {threads?.length === 0 && !listError && (
          <p className="px-4 py-6 text-sm text-navy-600">No conversations yet</p>
        )}
        <ul>
          {(threads ?? []).map((thread) => {
            const selected = activeId === thread.id;
            return (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => void openThread(thread.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={cn(
                    'w-full px-4 py-3 text-left hover:bg-navy-50',
                    selected && 'bg-navy-50',
                  )}
                >
                  <span className="block truncate text-sm font-medium text-navy-900">
                    {thread.title}
                  </span>
                  <span className="block text-xs text-navy-500">
                    {formatDate(thread.updatedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-label="Messages"
        aria-busy={loadingThread || undefined}
        className="flex min-h-[28rem] flex-col rounded-xl border border-navy-100 bg-white"
      >
        <div className="flex-1 space-y-3 p-4">
          {showEmpty && (
            <EmptyState title="Ask how a screen works, or ask for a record you are allowed to see." />
          )}
          {messages.map((message) => {
            const pending = message.proposal?.status === 'pending' && !dismissed.has(message.id);
            const mine = message.role === 'user';
            return (
              <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[80%] rounded-xl px-3 py-2 text-sm',
                    mine
                      ? 'bg-accent-600 text-white'
                      : 'border border-navy-100 bg-navy-50 text-navy-900',
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.body}</p>
                  {pending && (
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        onClick={() => void confirm(message.id)}
                        loading={confirmingId === message.id}
                      >
                        Confirm
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => cancel(message.id)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <form className="space-y-2 border-t border-navy-100 p-4" onSubmit={(e) => void send(e)}>
          <TextAreaField
            id="ask-message"
            label="Message"
            value={draft}
            maxLength={LIMIT}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error === 'Enter a message.') setError(null);
            }}
            error={error ?? undefined}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-navy-600">
              {draft.length}/{LIMIT}
            </p>
            <Button type="submit" loading={busy}>
              Send
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
