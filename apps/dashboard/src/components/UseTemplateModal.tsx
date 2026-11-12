import type { RenderedTemplateDto, TemplateSummaryDto } from '@assar/api-client';
import { Alert, Button, Modal, StatusPill, TextAreaField, TextField } from '@assar/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { buildDocx } from '../lib/docx';
import { uploadDocument } from '../lib/upload';
import { errorText, useAction } from '../lib/useAction';
import { useAsync } from '../lib/useAsync';
import { MatterPicker } from './Pickers';

const AI_INSTRUCTION_LIMIT = 4000;

/**
 * Fill a template for a matter: facts come from the matter, you add the rest, check the result, then
 * keep it as a Word document on the matter, copy it, or ask the AI to polish it from selected documents.
 */
export function UseTemplateModal({
  template,
  onClose,
}: {
  template: TemplateSummaryDto | null;
  onClose: () => void;
}) {
  const { client, can } = useAuth();
  const act = useAction();
  const [matterId, setMatterId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState<RenderedTemplateDto | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState<{
    tone: 'success' | 'error' | 'info';
    text: string;
    matterId?: string;
  } | null>(null);
  const [aiDocs, setAiDocs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A fresh start whenever a different template is opened.
    setMatterId('');
    setValues({});
    setRendered(null);
    setText('');
    setTitle(template?.name ?? '');
    setNote(null);
    setAiDocs([]);
  }, [template]);

  const docs = useAsync(
    () => (matterId ? client.documents(matterId, { limit: 100 }) : Promise.resolve(null)),
    [client, matterId],
  );

  async function fill() {
    if (!template) return;
    const typed = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
    const r = await act.run(() =>
      client.renderTemplate(template.id, { ...(matterId ? { matterId } : {}), values: typed }),
    );
    if (r) {
      setRendered(r);
      setText(r.text);
    }
  }

  const stillMissing = (text.match(/\[MISSING: [^\]]+\]/g) ?? []).length;

  async function saveAsWord() {
    if (!matterId)
      return setNote({ tone: 'error', text: 'Choose a matter to save the document on.' });
    setBusy(true);
    setNote(null);
    try {
      const file = await buildDocx(title.trim() || template!.name, text);
      const r = await uploadDocument(
        client,
        file,
        { matterId, title: title.trim() || template!.name },
        () => undefined,
      );
      setNote({
        tone: r.scan === 'blocked' ? 'error' : 'success',
        text:
          r.scan === 'blocked'
            ? 'The file failed the security scan and was not saved for use.'
            : 'Saved as a Word document on the matter.',
        matterId,
      });
    } catch (e) {
      setNote({
        tone: 'error',
        text: e instanceof Error && !('status' in e) ? e.message : errorText(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function polishWithAi() {
    const instructions = `Complete and polish this draft using only facts found in the sources. Keep its structure and keep every [MISSING: …] marker you cannot fill from the sources.\n\n${text}`;
    const job = await act.run(
      () =>
        client.createAiJob({
          task: 'drafting',
          matterId,
          documents: aiDocs.map((documentId) => ({ documentId })),
          instructions,
        }),
      'Sent to Ask Assar. The result will wait in Drafts until a person approves it.',
    );
    if (job)
      setNote({
        tone: 'info',
        text: 'Ask Assar is working on it. Open Drafts when the result is ready.',
      });
  }

  const custom = rendered?.placeholders.filter((p) => !p.builtin || p.missing) ?? [];
  return (
    <Modal
      open={!!template}
      onClose={onClose}
      title={template ? `Use: ${template.name}` : 'Use template'}
      wide
    >
      {template && (
        <div className="space-y-4">
          <p className="text-sm text-navy-600">
            Drafts are starting points for an attorney to review. Nothing is filled in that the
            system does not know.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
              <MatterPicker
                id="tmatter"
                label="Matter (fills in client, court and parties)"
                blank="No matter — fill by hand"
                value={matterId}
                onChange={(v) => {
                  setMatterId(v);
                  setRendered(null);
                }}
              />
            </div>
            <Button onClick={fill} loading={act.busy && !rendered}>
              {rendered ? 'Refresh' : 'Fill template'}
            </Button>
          </div>

          {rendered && (
            <>
              {custom.length > 0 && (
                <fieldset className="rounded-xl border border-navy-100 p-4">
                  <legend className="px-1 text-sm font-semibold text-navy-900">
                    Details to add
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {custom.map((p) => (
                      <TextField
                        key={p.key}
                        id={`ph-${p.key}`}
                        label={p.label ?? p.key.replace(/[._]/g, ' ')}
                        hint={p.builtin ? 'Not on record for this matter.' : undefined}
                        value={values[p.key] ?? ''}
                        onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                      />
                    ))}
                  </div>
                  <div className="mt-3">
                    <Button variant="secondary" onClick={fill} loading={act.busy}>
                      Apply details
                    </Button>
                  </div>
                </fieldset>
              )}
              <TextAreaField
                id="draft"
                label="Draft (you can edit it here)"
                rows={14}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="text-xs">
                {stillMissing > 0 ? (
                  <StatusPill tone="amber">
                    {stillMissing} blank{stillMissing === 1 ? '' : 's'} left to fill
                  </StatusPill>
                ) : (
                  <StatusPill tone="green">no blanks left</StatusPill>
                )}
              </p>

              {note && (
                <Alert tone={note.tone}>
                  {note.text}{' '}
                  {note.matterId && (
                    <Link className="font-medium underline" to={`/matters/${note.matterId}`}>
                      Open the matter
                    </Link>
                  )}
                </Alert>
              )}

              <div className="flex flex-wrap items-end gap-3 border-t border-navy-100 pt-4">
                <div className="min-w-60 flex-1">
                  <TextField
                    id="doctitle"
                    label="Document title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                {can('document:write') && (
                  <Button onClick={saveAsWord} loading={busy} disabled={!matterId}>
                    Save as Word document
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(text);
                      setNote({ tone: 'success', text: 'Copied to the clipboard.' });
                    } catch {
                      setNote({
                        tone: 'error',
                        text: 'Your browser did not allow copying. Select the text and copy it by hand.',
                      });
                    }
                  }}
                >
                  Copy text
                </Button>
              </div>

              {can('ai:use') && matterId && (
                <details className="rounded-xl border border-navy-100 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-navy-900">
                    Polish with AI from this matter's documents
                  </summary>
                  <div className="mt-3 space-y-2">
                    {text.length > AI_INSTRUCTION_LIMIT - 200 && (
                      <Alert tone="info">
                        This draft is too long to send to the AI as instructions (
                        {AI_INSTRUCTION_LIMIT} characters at most). Shorten it first.
                      </Alert>
                    )}
                    {docs.status === 'ready' && docs.data && docs.data.data.length === 0 && (
                      <p className="text-sm text-navy-600">
                        This matter has no documents to draw facts from.
                      </p>
                    )}
                    {docs.status === 'ready' &&
                      docs.data?.data.map((d) => (
                        <label key={d.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={aiDocs.includes(d.id)}
                            onChange={(e) =>
                              setAiDocs((cur) =>
                                e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id),
                              )
                            }
                          />
                          {d.title}
                        </label>
                      ))}
                    <Button
                      onClick={polishWithAi}
                      loading={act.busy}
                      disabled={aiDocs.length === 0 || text.length > AI_INSTRUCTION_LIMIT - 200}
                    >
                      Send to AI
                    </Button>
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
