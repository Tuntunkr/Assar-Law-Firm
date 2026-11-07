import type { DocumentListItem } from '@assar/api-client';
import { Button, StatusPill, Table, Td, Th } from '@assar/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate, label, toneOf } from '../lib/format';
import { usePaged } from '../lib/usePaged';
import { EmptyState } from './AsyncView';
import { DocumentVersionsModal } from './DocumentVersionsModal';
import { PagedView } from './Pager';
import { UploadModal } from './UploadModal';

/** Every document across all of a client's matters. Restricted matters appear only to people with access. */
export function ClientDocuments({ clientId }: { clientId: string }) {
  const { client, can } = useAuth();
  const paged = usePaged(
    (cursor) => client.documentSearch({ clientId, cursor, limit: 25 }),
    [client, clientId],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-4">
      {can('document:write') && (
        <div className="flex justify-end">
          <Button onClick={() => setUploading(true)}>Upload document</Button>
        </div>
      )}
      <PagedView
        paged={paged}
        empty={
          <EmptyState title="No documents for this client yet">
            Documents uploaded to any of the client's matters appear here.
          </EmptyState>
        }
      >
        {(items: DocumentListItem[]) => (
          <Table>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Matter</Th>
                <Th>Latest file</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="hover:bg-navy-50/50">
                  <Td className="font-medium">{d.title}</Td>
                  <Td>
                    {d.matter ? (
                      <Link
                        className="text-accent-700 hover:underline"
                        to={`/matters/${d.matter.id}`}
                      >
                        {d.matter.matterNumber}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-xs text-navy-600">
                    {d.latest ? `${d.latest.filename} · ${formatBytes(d.latest.sizeBytes)}` : '—'}
                  </Td>
                  <Td>
                    {d.latest ? (
                      <StatusPill tone={toneOf(d.latest.status)}>
                        {label(d.latest.status)}
                      </StatusPill>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>{formatDate(d.updatedAt)}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" onClick={() => setOpen(d.id)}>
                      Open
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PagedView>
      <DocumentVersionsModal
        documentId={open}
        onClose={() => setOpen(null)}
        onChanged={paged.reload}
      />
      {/* The upload dialog asks which of the client's matters the file belongs to. */}
      <UploadModal
        open={uploading}
        clientId={clientId}
        onClose={() => setUploading(false)}
        onUploaded={paged.reload}
      />
    </div>
  );
}
