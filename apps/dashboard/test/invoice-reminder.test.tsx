import type { InvoiceDto, StaffClient, StaffMe } from '@assar/api-client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NotifyProvider } from '../src/components/notify';
import { AuthProvider } from '../src/lib/auth';
import { InvoiceDetailPage } from '../src/pages/InvoiceDetailPage';

const billing: StaffMe = {
  user: { id: 'u1', email: 'bill@firm.test', name: 'Bea Billing' },
  organization: { id: 'o1', name: 'Smith & Co', slug: 'smith-co' },
  role: 'billing',
  permissions: ['billing:read', 'billing:write', 'assistant:use'],
  mfa: { enabled: false, enrollmentRequired: false },
  csrfToken: 'csrf',
};

const invoice: InvoiceDto = {
  id: 'inv1',
  number: 'INV-1',
  clientId: 'c1',
  status: 'issued',
  currency: 'USD',
  subtotalCents: 10000,
  taxRateBp: 0,
  taxCents: 0,
  totalCents: 10000,
  amountPaidCents: 0,
  balanceCents: 10000,
  issuedAt: '2026-10-01T00:00:00.000Z',
  dueAt: '2026-10-15T00:00:00.000Z',
  paidAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  dueDays: 14,
  notes: null,
  voidReason: null,
  lines: [],
  payments: [],
  reminders: [],
};

function renderInvoice(client: StaffClient) {
  return render(
    <MemoryRouter initialEntries={['/invoices/inv1']}>
      <AuthProvider client={client}>
        <NotifyProvider>
          <Routes>
            <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          </Routes>
        </NotifyProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('invoice payment reminder', () => {
  let logInvoiceReminder: Mock;
  let client: StaffClient;

  beforeEach(() => {
    logInvoiceReminder = vi.fn().mockResolvedValue({ ...invoice, reminders: [] });
    client = {
      me: vi.fn().mockResolvedValue(billing),
      invoice: vi.fn().mockResolvedValue(invoice),
      invoiceReminderDraft: vi.fn().mockResolvedValue({
        daysPastDue: 28,
        step: 7,
        text: 'Please pay invoice INV-1. The balance is $100.00.',
      }),
      logInvoiceReminder,
    } as unknown as StaffClient;
  });

  it('shows the draft and records the channel the firm used', async () => {
    const user = userEvent.setup();
    renderInvoice(client);
    expect(
      await screen.findByDisplayValue('Please pay invoice INV-1. The balance is $100.00.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record reminder' }));
    expect(logInvoiceReminder).toHaveBeenCalledWith('inv1', { channel: 'phone' });
  });

  it('lets a reader see the message without recording a send', async () => {
    client.me = vi.fn().mockResolvedValue({
      ...billing,
      permissions: ['billing:read'],
    });
    renderInvoice(client);
    expect(
      await screen.findByDisplayValue('Please pay invoice INV-1. The balance is $100.00.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record reminder' })).not.toBeInTheDocument();
    expect(logInvoiceReminder).not.toHaveBeenCalled();
  });
});
