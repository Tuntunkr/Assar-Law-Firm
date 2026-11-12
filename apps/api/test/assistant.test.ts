import type { INestApplication } from '@nestjs/common';
import type { Composer } from '../src/assistant/assistant.service';
import type { Member } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bootApp, post, registerWithMfa } from './helpers';

const REFUSAL = 'I can only help with this dashboard and the records your role can see.';

/**
 * Throws when the cricket question is handed to the model, so a wrong call cannot
 * look like the fixed refusal. Help replies are the guide chunk itself.
 */
const composer: Composer = {
  async compose(input) {
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    if (/who won the cricket match/i.test(lastUser?.content ?? '')) {
      throw new Error('composer must not be called');
    }
    if (input.kind !== 'help') throw new Error('composer must not be called');
    if (!input.system.toLowerCase().includes('answer only from the chunk')) {
      throw new Error('help system instruction missing');
    }
    if (!input.system.includes("I don't have that in the dashboard guide.")) {
      throw new Error('help fallback missing');
    }
    return input.chunk ?? '';
  },
};

let app: INestApplication;
let staff: Member;
let other: Member;
let threadId: string;
let proposalMessageId: string;

beforeAll(async () => {
  app = await bootApp({}, { composer });
  const owner = await registerWithMfa(app);
  staff = await addMember(app, owner, 'staff');
  other = await addMember(app, owner, 'staff');
  const created = await post(staff, '/v1/assistant/threads', {});
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  threadId = created.body.id as string;
});

afterAll(async () => {
  await app.close();
});

const send = (who: Member, body: string) =>
  post(who, `/v1/assistant/threads/${threadId}/messages`, { body });

describe('Ask Assar', () => {
  it('refuses an outside question without calling the composer', async () => {
    const res = await send(staff, 'Who won the cricket match?');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.body).toBe(REFUSAL);
  });

  it('answers how to open Matters from the guide', async () => {
    const res = await send(staff, 'How do I open Matters?');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.body).toContain('Matters');
  });

  it('creates a task only after the user confirms, and only once', async () => {
    const res = await send(staff, 'Add a task called Call the client');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.body).toContain('Call the client');
    expect(res.body.body.toLowerCase()).toContain('confirm');
    proposalMessageId = res.body.id as string;

    const before = await staff.agent.get('/v1/tasks').expect(200);
    expect(
      before.body.data.filter((t: { title: string }) => t.title === 'Call the client'),
    ).toHaveLength(0);

    const confirm = await post(staff, `/v1/assistant/threads/${threadId}/confirm`, {
      messageId: proposalMessageId,
    });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);

    const after = await staff.agent.get('/v1/tasks').expect(200);
    expect(
      after.body.data.filter((t: { title: string }) => t.title === 'Call the client'),
    ).toHaveLength(1);

    const again = await post(staff, `/v1/assistant/threads/${threadId}/confirm`, {
      messageId: proposalMessageId,
    });
    expect(again.status, JSON.stringify(again.body)).toBe(404);

    const still = await staff.agent.get('/v1/tasks').expect(200);
    expect(
      still.body.data.filter((t: { title: string }) => t.title === 'Call the client'),
    ).toHaveLength(1);
  });

  it('returns 404 when another staff user in the firm opens, writes, or confirms the thread', async () => {
    await other.agent.get(`/v1/assistant/threads/${threadId}`).expect(404);
    const posted = await send(other, 'How do I open Matters?');
    expect(posted.status, JSON.stringify(posted.body)).toBe(404);
    const confirmed = await post(other, `/v1/assistant/threads/${threadId}/confirm`, {
      messageId: proposalMessageId,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(404);

    const tasks = await staff.agent.get('/v1/tasks').expect(200);
    expect(
      tasks.body.data.filter((t: { title: string }) => t.title === 'Call the client'),
    ).toHaveLength(1);
  });
});
