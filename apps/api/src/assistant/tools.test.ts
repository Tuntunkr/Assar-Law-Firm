import { ROLE_PERMISSIONS, type Role } from '@assar/types';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../common/auth-context';
import { runTool, type ToolServices } from './tools';

function auth(role: Role): AuthContext {
  return {
    userId: '507f1f77bcf86cd799439011',
    organizationId: '507f1f77bcf86cd799439012',
    role,
    sessionTokenHash: 'hash',
    csrfToken: 'csrf',
    mfaEnabled: true,
    mfaEnrollmentRequired: false,
  };
}

function services() {
  const invoices = {
    list: vi.fn(async () => ({ data: [{ id: 'inv-1', status: 'issued' }] })),
  };
  const tasks = { list: vi.fn(), create: vi.fn() };
  const bundle: ToolServices = {
    clients: { list: vi.fn() },
    matters: { list: vi.fn() },
    tasks,
    invoices,
    calendar: { list: vi.fn() },
  };
  return { bundle, invoices, tasks };
}

describe('runTool', () => {
  it('lets a billing user list unpaid invoices and refuses staff without calling invoices', async () => {
    expect(ROLE_PERMISSIONS.billing).toContain('billing:read');
    expect(ROLE_PERMISSIONS.staff).not.toContain('billing:read');

    const billing = auth('billing');
    const allowed = services();
    const found = await runTool('invoices.unpaid', {}, billing, allowed.bundle);
    expect(found).toEqual({ ok: true, data: { data: [{ id: 'inv-1', status: 'issued' }] } });
    expect(allowed.invoices.list).toHaveBeenCalledTimes(1);
    expect(allowed.invoices.list).toHaveBeenCalledWith(
      billing,
      expect.objectContaining({ status: 'issued' }),
    );

    const denied = services();
    expect(await runTool('invoices.unpaid', {}, auth('staff'), denied.bundle)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(denied.invoices.list).not.toHaveBeenCalled();
  });

  it('proposes a task for staff and refuses billing without calling create', async () => {
    expect(ROLE_PERMISSIONS.staff).toContain('task:write');
    expect(ROLE_PERMISSIONS.billing).not.toContain('task:write');

    const input = { title: 'Call the client' };
    const staffServices = services();
    expect(await runTool('tasks.create', input, auth('staff'), staffServices.bundle)).toEqual({
      ok: true,
      data: { proposal: { tool: 'tasks.create', arguments: input } },
    });
    expect(staffServices.tasks.create).not.toHaveBeenCalled();
    expect(staffServices.tasks.list).not.toHaveBeenCalled();

    const billingServices = services();
    expect(await runTool('tasks.create', input, auth('billing'), billingServices.bundle)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(billingServices.tasks.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool name', async () => {
    const fake = services();
    expect(await runTool('not.a.tool', {}, auth('owner'), fake.bundle)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(fake.invoices.list).not.toHaveBeenCalled();
    expect(fake.tasks.create).not.toHaveBeenCalled();
  });
});
