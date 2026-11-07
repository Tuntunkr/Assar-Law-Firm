import type { Job } from 'bullmq';
import { OrganizationModel, dispatchInvoiceReminders } from '@assar/database';
import type { JobLogger } from './names.js';

export interface BillingProcessorDeps {
  logger: JobLogger;
}

/**
 * The daily billing sweep: for every active firm, tell the right people about invoices that reached a
 * reminder step. One firm's failure is logged and skipped so it can never stop the others, and the whole
 * sweep is safe to run twice (notifications are keyed by invoice, step and person).
 */
export function createBillingProcessor(deps: BillingProcessorDeps) {
  return async (
    _job?: Job,
  ): Promise<{ firms: number; invoices: number; notified: number; failed: number }> => {
    let firms = 0;
    let invoices = 0;
    let notified = 0;
    let failed = 0;
    for await (const org of OrganizationModel.find({ status: 'active' })
      .select('_id')
      .lean()
      .cursor()) {
      firms++;
      try {
        const r = await dispatchInvoiceReminders(org._id);
        invoices += r.invoices;
        notified += r.notified;
      } catch (e) {
        failed++;
        deps.logger.error(
          { organizationId: String(org._id), error: (e as Error).message?.slice(0, 200) },
          'invoice reminder sweep failed for a firm',
        );
      }
    }
    deps.logger.info({ firms, invoices, notified, failed }, 'invoice reminder sweep finished');
    return { firms, invoices, notified, failed };
  };
}
