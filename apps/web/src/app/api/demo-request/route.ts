import { NextResponse } from 'next/server';
import { demoBookingSchema, demoRequestSchema } from '@assar/validation';

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const localApi = () => {
  const raw = process.env.ASSAR_API_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:') return null;
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
    if (url.port !== '4000') return null;
    return url.origin;
  } catch {
    return null;
  }
};

async function readBody(req: Request): Promise<unknown> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return req.json().catch(() => null);
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await req.formData();
    return {
      name: form.get('name'),
      email: form.get('email'),
      firm: form.get('firm'),
      firmSize: form.get('firmSize'),
      message: form.get('message') || undefined,
      consent: form.get('consent') === 'on' ? true : form.get('consent'),
      slotStart: form.get('slotStart') || undefined,
    };
  }
  return null;
}

/**
 * Local mode stores a synthetic booking on the API at 127.0.0.1:4000.
 * An external inbox is used only when DEMO_BOOKING is not local and DEMO_REQUEST_ENDPOINT is https.
 * Nothing here sends mail or writes a calendar.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  if (process.env.DEMO_BOOKING === 'local') {
    const parsed = demoBookingSchema.safeParse(body);
    if (!parsed.success)
      return fail(400, 'VALIDATION_FAILED', 'Please check the form and try again.');
    const api = localApi();
    if (!api)
      return fail(
        503,
        'NOT_CONFIGURED',
        'The local demo API is not configured. Nothing was stored.',
      );
    try {
      const res = await fetch(`${api}/v1/demo-bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: { message?: string };
        notification?: string;
      } | null;
      if (!res.ok)
        return fail(
          res.status === 409 ? 409 : 502,
          'UPSTREAM_FAILED',
          payload?.error?.message ?? 'The booking was not stored.',
        );
      return NextResponse.json(
        { ok: true, status: 'recorded_local', notification: payload?.notification ?? 'not_sent' },
        { status: 201 },
      );
    } catch {
      return fail(502, 'UPSTREAM_FAILED', 'The local API did not answer. Nothing was stored.');
    }
  }

  const parsed = demoRequestSchema.safeParse(body);
  if (!parsed.success)
    return fail(400, 'VALIDATION_FAILED', 'Please check the form and try again.');
  const endpoint = process.env.DEMO_REQUEST_ENDPOINT;
  if (!endpoint)
    return fail(503, 'NOT_CONFIGURED', 'Demo booking is not configured. No request was stored.');
  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    return fail(503, 'NOT_CONFIGURED', 'Demo booking is not configured. No request was stored.');
  }
  if (target.protocol !== 'https:')
    return fail(503, 'NOT_CONFIGURED', 'Demo booking is not configured. No request was stored.');

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok)
      return fail(502, 'UPSTREAM_FAILED', 'We could not send your request. Please try again.');
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return fail(502, 'UPSTREAM_FAILED', 'We could not send your request. Please try again.');
  }
}

export async function GET() {
  if (process.env.DEMO_BOOKING !== 'local')
    return fail(503, 'NOT_CONFIGURED', 'Demo booking is not configured.');
  const api = localApi();
  if (!api) return fail(503, 'NOT_CONFIGURED', 'The local demo API is not configured.');
  try {
    const res = await fetch(`${api}/v1/demo-bookings/slots`);
    const payload = await res.json().catch(() => null);
    if (!res.ok) return fail(502, 'UPSTREAM_FAILED', 'Open slots could not be loaded.');
    return NextResponse.json(payload);
  } catch {
    return fail(502, 'UPSTREAM_FAILED', 'Open slots could not be loaded.');
  }
}
