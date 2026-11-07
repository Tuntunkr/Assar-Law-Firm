import { PageHeader, Table, Td, TextField, Th } from '@assar/ui';
import { useState } from 'react';
import { EmptyState } from '../components/AsyncView';
import { PagedView } from '../components/Pager';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { usePeople } from '../lib/people';
import { usePaged } from '../lib/usePaged';

export function AuditPage() {
  const { client } = useAuth();
  const { name } = usePeople();
  const [action, setAction] = useState('');
  const paged = usePaged(
    (cursor) => client.auditLogs({ action: action || undefined, cursor, limit: 50 }),
    [client, action],
  );
  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of security and data events."
      />
      <div className="mb-4 w-72">
        <TextField
          id="aaction"
          label="Filter by action"
          placeholder="e.g. auth.login_failed"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </div>
      <PagedView paged={paged} empty={<EmptyState title="No events match" />}>
        {(items) => (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Who</Th>
                <Th>Target</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td>{a.actorId ? name(a.actorId) : a.actorType}</Td>
                  <Td className="text-xs text-navy-600">{a.targetType ?? '—'}</Td>
                  <Td className="text-xs text-navy-600">{a.ip ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
    </>
  );
}
