import { NextResponse } from 'next/server';
import { demoRequestSchema } from '@assar/validation';

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Validates the request and forwards it to the backend. Until the API endpoint exists
 * (DEMO_REQUEST_ENDPOINT), we return 503 rather than pretending the request was stored.
 */
export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = demoRequestSchema.safeParse(body);
  if (!parsed.success)
    return fail(400, 'VALIDATION_FAILED', 'Please check the form and try again.');

  const endpoint = process.env.DEMO_REQUEST_ENDPOINT;
  if (!endpoint)
    return fail(
      503,
      'NOT_CONFIGURED',
      'Demo booking is not configured. No request was stored.',
    );

  try {
    const res = await fetch(endpoint, {
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
