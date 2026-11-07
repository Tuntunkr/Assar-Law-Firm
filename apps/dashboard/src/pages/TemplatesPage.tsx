import { BUILTIN_PLACEHOLDERS, TEMPLATE_CATEGORIES, extractPlaceholders } from '@assar/types';
import type { TemplateSummaryDto } from '@assar/api-client';
import { Button, Card, Modal, PageHeader, SelectField, StatusPill, TextField } from '@assar/ui';
import { useRef, useState } from 'react';
import { AsyncView, EmptyState } from '../components/AsyncView';
import { UseTemplateModal } from '../components/UseTemplateModal';
import { useAuth } from '../lib/auth';
import { label } from '../lib/format';
import { useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';

export function TemplatesPage() {
  const { client, can } = useAuth();
  const act = useAction();
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [using, setUsing] = useState<TemplateSummaryDto | null>(null);
  const state = useAsync(
    () =>
      client.templates({
        status: archived ? 'archived' : 'active',
        category: category || undefined,
      }),
    [client, category, archived],
  );
  const write = can('document:write');

  return (
    <>
      <PageHeader
        title="Templates"
        description="Notices, agreements, letters and filings you reuse. Placeholders like {{client.name}} fill in from the matter."
        actions={write && <Button onClick={() => setEditing({})}>New template</Button>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-52">
          <SelectField
            id="tcat"
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All</option>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </SelectField>
        </div>
        <label className="mb-2 flex items-center gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{' '}
          Show archived
        </label>
      </div>
      <AsyncView
        state={state}
        onRetry={state.reload}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-32 animate-pulse rounded-xl bg-navy-100" />
            <div className="h-32 animate-pulse rounded-xl bg-navy-100" />
          </div>
        }
        isEmpty={(p) => p.data.length === 0}
        empty={
          <EmptyState title={archived ? 'Nothing archived' : 'No templates yet'}>
            Create one, or change the filter.
          </EmptyState>
        }
      >
        {(p) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {p.data.map((t) => (
              <Card key={t.id} className="flex flex-col">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-navy-900">{t.name}</h2>
                  <StatusPill tone="blue">{label(t.category)}</StatusPill>
                </div>
                <p className="flex-1 text-sm text-navy-600">{t.description ?? 'No description.'}</p>
                <p className="mt-2 text-xs text-navy-500">
                  {t.placeholders.length} placeholder{t.placeholders.length === 1 ? '' : 's'}
                  {t.starter ? ' · starter template' : ''}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {t.status === 'active' && <Button onClick={() => setUsing(t)}>Use</Button>}
                  {write && (
                    <Button variant="secondary" onClick={() => setEditing({ id: t.id })}>
                      Edit
                    </Button>
                  )}
                  {write && (
                    <Button
                      variant="ghost"
                      disabled={act.busy}
                      onClick={async () => {
                        if (
                          await act.run(
                            () =>
                              client.updateTemplate(t.id, {
                                status: t.status === 'active' ? 'archived' : 'active',
                              }),
                            t.status === 'active' ? 'Template archived' : 'Template restored',
                          )
                        )
                          state.reload();
                      }}
                    >
                      {t.status === 'active' ? 'Archive' : 'Restore'}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </AsyncView>
      <UseTemplateModal template={using} onClose={() => setUsing(null)} />
      {editing && (
        <TemplateEditor
          id={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      )}
    </>
  );
}

function TemplateEditor({
  id,
  onClose,
  onSaved,
}: {
  id?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client } = useAuth();
  const act = useAction();
  const existing = useAsync(() => (id ? client.template(id) : Promise.resolve(null)), [client, id]);
  const [f, setF] = useState<{
    name: string;
    category: string;
    description: string;
    body: string;
  } | null>(id ? null : { name: '', category: 'letter', description: '', body: '' });
  const area = useRef<HTMLTextAreaElement>(null);
  const form =
    f ??
    (existing.status === 'ready' && existing.data
      ? {
          name: existing.data.name,
          category: existing.data.category,
          description: existing.data.description ?? '',
          body: existing.data.body,
        }
      : null);

  const insert = (key: string) => {
    if (!form) return;
    const el = area.current;
    const at = el?.selectionStart ?? form.body.length;
    const end = el?.selectionEnd ?? at;
    setF({ ...form, body: `${form.body.slice(0, at)}{{${key}}}${form.body.slice(end)}` });
  };

  return (
    <Modal open onClose={onClose} title={id ? 'Edit template' : 'New template'} wide>
      {!form ? (
        <div className="h-40 animate-pulse rounded-xl bg-navy-100" />
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = {
              name: form.name,
              category: form.category,
              description: form.description.trim() || (id ? null : undefined),
              body: form.body,
            };
            const r = await act.run(
              () => (id ? client.updateTemplate(id, body) : client.createTemplate(body as never)),
              'Template saved',
            );
            if (r) onSaved();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <TextField
                id="tname"
                label="Name"
                value={form.name}
                onChange={(e) => setF({ ...form, name: e.target.value })}
                error={act.errors.name}
                required
              />
            </div>
            <SelectField
              id="tcategory"
              label="Category"
              value={form.category}
              onChange={(e) => setF({ ...form, category: e.target.value })}
            >
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField
            id="tdescription"
            label="Description"
            value={form.description}
            onChange={(e) => setF({ ...form, description: e.target.value })}
            error={act.errors.description}
          />
          <div>
            <p className="mb-1 text-sm font-medium text-navy-900">Insert a fact from the matter</p>
            <div className="flex flex-wrap gap-1.5">
              {BUILTIN_PLACEHOLDERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => insert(p.key)}
                  className="rounded-full border border-navy-200 bg-white px-2.5 py-0.5 text-xs text-navy-800 hover:bg-navy-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="tbody" className="mb-1 block text-sm font-medium text-navy-900">
              Text
            </label>
            <textarea
              id="tbody"
              ref={area}
              rows={16}
              value={form.body}
              onChange={(e) => setF({ ...form, body: e.target.value })}
              aria-invalid={!!act.errors.body || undefined}
              className="block w-full rounded-lg border border-navy-200 bg-white px-3 py-2 font-mono text-sm text-navy-900 focus-visible:outline-2 focus-visible:outline-accent-500"
            />
            {act.errors.body && (
              <p role="alert" className="mt-1 text-xs font-medium text-red-700">
                {act.errors.body}
              </p>
            )}
            <p className="mt-1 text-xs text-navy-600">
              Use {'{{name}}'} for anything to fill in. {extractPlaceholders(form.body).length}{' '}
              placeholder{extractPlaceholders(form.body).length === 1 ? '' : 's'} found.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={act.busy}>
              Save template
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
