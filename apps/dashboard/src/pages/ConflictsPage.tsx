import type { ConflictResultDto } from '@assar/api-client';
import { Alert, Button, Card, PageHeader, StatusPill, TextAreaField } from '@assar/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/useAction';

export function ConflictsPage() {
  const { client } = useAuth();
  const act = useAction();
  const [text, setText] = useState('');
  const [result, setResult] = useState<ConflictResultDto | null>(null);
  return (
    <>
      <PageHeader
        title="Conflict check"
        description="Search clients and matter parties for names before taking on new work."
      />
      <Card className="mb-6 max-w-2xl">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const names = text
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            setResult((await act.run(() => client.conflictCheck(names))) ?? null);
          }}
        >
          <TextAreaField
            id="cnames"
            label="Names to check (one per line)"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={act.errors.names}
            required
          />
          <Button type="submit" loading={act.busy}>
            Run check
          </Button>
        </form>
      </Card>
      {result && (
        <div className="space-y-4">
          <Alert tone="info">{result.notice}</Alert>
          {result.results.map((r) => (
            <Card key={r.query}>
              <h2 className="font-semibold text-navy-900">{r.query}</h2>
              {r.matches.length === 0 ? (
                <p className="mt-2 text-sm text-emerald-800">No matches found.</p>
              ) : (
                <ul className="mt-2 divide-y divide-navy-50 text-sm">
                  {r.matches.map((m, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      {m.restricted ? (
                        <span className="text-navy-700">
                          A match exists in a restricted matter — contact the responsible attorney.
                        </span>
                      ) : (
                        <span>
                          {m.name} ·{' '}
                          {m.matterId ? (
                            <Link
                              className="text-accent-700 hover:underline"
                              to={`/matters/${m.matterId}`}
                            >
                              {m.matterNumber} {m.matterTitle}
                            </Link>
                          ) : (
                            m.source
                          )}
                        </span>
                      )}
                      <StatusPill tone={m.matchType === 'exact' ? 'red' : 'amber'}>
                        {m.matchType}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
