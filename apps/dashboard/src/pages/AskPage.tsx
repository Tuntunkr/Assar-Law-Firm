import { PageHeader, Tabs } from '@assar/ui';
import { useState } from 'react';
import { AskPanel } from '../components/AskPanel';
import { useAuth } from '../lib/auth';
import { AiPage } from './AiPage';

export function AskPage() {
  const { can } = useAuth();
  const drafts = can('ai:use');
  const [section, setSection] = useState<'chat' | 'drafts'>('chat');
  return (
    <>
      <PageHeader
        title="Ask Assar"
        description={
          drafts
            ? 'Ask how this dashboard works, or review document drafts. A draft stays a draft until a person approves it.'
            : 'Questions about this dashboard, limited to what your role can see.'
        }
      />
      {drafts && (
        <Tabs
          label="Ask Assar sections"
          value={section}
          onChange={setSection}
          tabs={[
            { id: 'chat', label: 'Chat' },
            { id: 'drafts', label: 'Drafts' },
          ]}
        />
      )}
      {section === 'drafts' && drafts ? <AiPage /> : <AskPanel />}
    </>
  );
}
