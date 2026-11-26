import type { INestApplication } from '@nestjs/common';
import { memberships } from '@assar/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootApp, newClient, newMatter, post, registerWithMfa } from './helpers';

let app: INestApplication;
beforeAll(async () => {
  app = await bootApp();
});
afterAll(async () => {
  await app.close();
});

describe('matter identity without a member directory', () => {
  it('shows the lead and team on a readable matter and hides every other firm', async () => {
    const owner = await registerWithMfa(app, 'Identity Firm');
    const attorney = await addMember(app, owner, 'attorney');
    const intern = await addMember(app, owner, 'intern');
    const other = await registerWithMfa(app, 'Other Firm');
    const clientId = await newClient(owner, 'Identity Client');
    const team = await post(owner, '/v1/teams', {
      name: 'Desk team',
      userIds: [attorney.userId],
    }).expect(201);
    const matter = await newMatter(owner, clientId, {
      title: 'Assigned identity matter',
      leadAttorneyId: attorney.userId,
      teamIds: [team.body.id],
    });
    const hidden = await newMatter(owner, clientId, { title: 'Matter the intern is not assigned' });

    const seen = await attorney.agent.get(`/v1/matters/${matter.id}`).expect(200);
    expect(seen.body.leadAttorneyName).toBe('Test attorney');
    expect(seen.body.teams).toEqual([{ id: team.body.id, name: 'Desk team' }]);
    expect(seen.body.teams[0]).not.toHaveProperty('userIds');
    expect(seen.body).not.toHaveProperty('email');
    const otherEmail = (other.body.user as { id: string; email?: string }).email ?? '';
    expect(otherEmail).toContain('@');
    expect(JSON.stringify(seen.body)).not.toContain(otherEmail);
    await attorney.agent.get('/v1/organization/members').expect(403);

    await intern.agent.get(`/v1/matters/${matter.id}`).expect(404);
    const task = await post(attorney, '/v1/tasks', {
      title: 'Intern filing note',
      matterId: matter.id,
      assigneeId: intern.userId,
    }).expect(201);
    expect(task.body.assigneeName).toBe('Test intern');

    const internMatter = await intern.agent.get(`/v1/matters/${matter.id}`).expect(200);
    expect(internMatter.body.leadAttorneyName).toBe('Test attorney');
    expect(internMatter.body.title).toBe('Assigned identity matter');
    await intern.agent.get(`/v1/matters/${hidden.id}`).expect(404);
    const internTasks = await intern.agent.get('/v1/tasks').expect(200);
    expect(internTasks.body.data.map((t: { title: string }) => t.title)).toContain('Intern filing note');
    expect(internTasks.body.data.find((t: { title: string }) => t.title === 'Intern filing note').assigneeName).toBe(
      'Test intern',
    );
    await intern.agent.get('/v1/organization/members').expect(403);

    await attorney.agent.get(`/v1/matters/${(await newMatter(other, await newClient(other))).id}`).expect(404);
    expect(await memberships.displayNames(owner.body.organization.id, [other.body.user.id])).toEqual([]);
  });
});
