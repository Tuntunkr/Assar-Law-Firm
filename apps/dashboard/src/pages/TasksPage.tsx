import type { TaskDto } from '@assar/api-client';
import {
  Button,
  Modal,
  PageHeader,
  SelectField,
  StatusPill,
  Table,
  Td,
  TextAreaField,
  TextField,
  Th,
} from '@assar/ui';
import { useState } from 'react';
import { EmptyState } from '../components/AsyncView';
import { PagedView } from '../components/Pager';
import { MatterPicker, MemberPicker } from '../components/Pickers';
import { useAuth } from '../lib/auth';
import { formatDate, isOverdue, label, toneOf } from '../lib/format';
import { usePeople } from '../lib/people';
import { useAction } from '../lib/useAction';
import { usePaged } from '../lib/usePaged';

export function TasksPage() {
  const { client } = useAuth();
  const { name } = usePeople();
  const act = useAction();
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const paged = usePaged(
    (cursor) =>
      client.tasks({
        assigneeId: scope === 'me' ? 'me' : undefined,
        status: status || undefined,
        cursor,
        limit: 25,
      }),
    [client, scope, status],
  );
  const setTaskStatus = async (t: TaskDto, s: string) => {
    if (await act.run(() => client.updateTask(t.id, { status: s }))) paged.reload();
  };
  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work to do, by person and matter."
        actions={<Button onClick={() => setCreating(true)}>New task</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-44">
          <SelectField
            id="scope"
            label="Show"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'me' | 'all')}
          >
            <option value="me">Assigned to me</option>
            <option value="all">Everyone</option>
          </SelectField>
        </div>
        <div className="w-44">
          <SelectField
            id="tstatus"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Any</option>
            {['todo', 'in_progress', 'done', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      <PagedView
        paged={paged}
        empty={<EmptyState title="No tasks">Nothing matches these filters.</EmptyState>}
      >
        {(items: TaskDto[]) => (
          <Table>
            <thead>
              <tr>
                <Th>Task</Th>
                <Th>Assignee</Th>
                <Th>Priority</Th>
                <Th>Due</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="hover:bg-navy-50/50">
                  <Td className="max-w-md">
                    <p className="font-medium">{t.title}</p>
                    {t.description && (
                      <p className="truncate text-xs text-navy-600">{t.description}</p>
                    )}
                  </Td>
                  <Td>{t.assigneeName || name(t.assigneeId)}</Td>
                  <Td>
                    <StatusPill tone={toneOf(t.priority)}>{t.priority}</StatusPill>
                  </Td>
                  <Td className={isOverdue(t.dueAt, t.status) ? 'font-medium text-red-700' : ''}>
                    {formatDate(t.dueAt)}
                  </Td>
                  <Td>
                    <select
                      aria-label={`Status of ${t.title}`}
                      className="rounded-md border border-navy-200 bg-white px-2 py-1 text-xs"
                      value={t.status}
                      disabled={act.busy}
                      onChange={(e) => setTaskStatus(t, e.target.value)}
                    >
                      {['todo', 'in_progress', 'done', 'cancelled'].map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
      <NewTaskModal open={creating} onClose={() => setCreating(false)} onCreated={paged.reload} />
    </>
  );
}

function NewTaskModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { client } = useAuth();
  const { run, busy, errors } = useAction();
  const [f, setF] = useState({
    title: '',
    description: '',
    priority: 'normal',
    matterId: '',
    assigneeId: '',
    due: '',
  });
  return (
    <Modal open={open} onClose={onClose} title="New task">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            title: f.title,
            priority: f.priority,
            ...(f.description ? { description: f.description } : {}),
            ...(f.matterId ? { matterId: f.matterId } : {}),
            ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
            ...(f.due ? { dueAt: new Date(`${f.due}T17:00:00`).toISOString() } : {}),
          };
          if (await run(() => client.createTask(body), 'Task created')) {
            onClose();
            setF({ ...f, title: '', description: '' });
            onCreated();
          }
        }}
      >
        <TextField
          id="ttitle"
          label="Title"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          error={errors.title}
          required
        />
        <TextAreaField
          id="tdesc"
          label="Description"
          rows={3}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          error={errors.description}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <MemberPicker
            id="tassignee"
            label="Assignee"
            value={f.assigneeId}
            onChange={(v) => setF({ ...f, assigneeId: v })}
          />
          <SelectField
            id="tprio"
            label="Priority"
            value={f.priority}
            onChange={(e) => setF({ ...f, priority: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </SelectField>
        </div>
        <MatterPicker
          id="tmatter"
          label="Matter (optional)"
          blank="No matter"
          value={f.matterId}
          onChange={(v) => setF({ ...f, matterId: v })}
        />
        <TextField
          id="tdue"
          label="Due date"
          type="date"
          value={f.due}
          onChange={(e) => setF({ ...f, due: e.target.value })}
          error={errors.dueAt}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create task
          </Button>
        </div>
      </form>
    </Modal>
  );
}
