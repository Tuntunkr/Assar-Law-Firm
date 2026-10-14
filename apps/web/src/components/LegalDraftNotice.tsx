import { Alert } from '@assar/ui';

export function LegalDraftNotice() {
  return (
    <Alert tone="info">
      This document is a draft template and has not been reviewed by counsel. It must be reviewed
      and completed by a qualified lawyer before launch.
    </Alert>
  );
}
