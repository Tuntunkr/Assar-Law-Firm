import { PageHeader } from '@assar/ui';
import { AskPanel } from '../components/AskPanel';

export function AskPage() {
  return (
    <>
      <PageHeader
        title="Ask Assar"
        description="Questions about this dashboard, limited to what your role can see."
      />
      <AskPanel />
    </>
  );
}
