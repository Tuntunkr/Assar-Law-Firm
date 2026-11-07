import type { DocumentListItem } from '@assar/api-client';
import { Button, PageHeader, StatusPill, Table, Td, TextField, Th } from '@assar/ui';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/AsyncView';
import { ContentSearch } from '../components/ContentSearch';
import { DocumentVersionsModal } from '../components/DocumentVersionsModal';
import { PagedView } from '../components/Pager';
import { ClientPicker } from '../components/Pickers';
import { UploadModal } from '../components/UploadModal';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate, label, toneOf } from '../lib/format';
import { usePaged } from '../lib/usePaged';

export function DocumentsPage() {
  const { client, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [inside, setInside] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [uploading, setUploading] = useState(params.get('new') === '1');
  const paged = usePaged(
    (cursor) =>
      client.documentSearch({
        q: q || undefined,
        clientId: clientId || undefined,
        cursor,
        limit: 25,
      }),
    [client, q, clientId],
  );

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every document across your matters. Restricted matters appear only to people with access."
        actions={
          can('document:write') && (
            <Button onClick={() => setUploading(true)}>Upload document</Button>
          )
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <TextField
          id="dq"
          label="Search"
          placeholder="Document title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ClientPicker
          id="dclient"
          label="Client"
          blank="All clients"
          value={clientId}
          onChange={setClientId}
        />
      </div>
      <label className="mb-4 flex items-center gap-2 text-sm text-navy-800">
        <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} />
        Search inside documents, including scanned files (type at least 2 characters)
      </label>
      {inside && q.trim().length >= 2 ? (
        <ContentSearch query={q.trim()} clientId={clientId || undefined} onOpen={setOpen} />
      ) : (
        <PagedView
          paged={paged}
          empty={
            <EmptyState title="No documents found">
              Upload a document to a matter to see it here.
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
      )}
      <DocumentVersionsModal
        documentId={open}
        onClose={() => setOpen(null)}
        onChanged={paged.reload}
      />
      <UploadModal
        open={uploading}
        onClose={() => {
          setUploading(false);
          if (params.has('new')) setParams({}, { replace: true });
        }}
        onUploaded={paged.reload}
      />
    </>
  );
}
