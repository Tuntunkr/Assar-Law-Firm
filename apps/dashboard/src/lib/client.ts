import { createStaffClient, type StaffClient } from '@assar/api-client';

export const SESSION_EXPIRED_EVENT = 'dashboard:session-expired';

/** The real client. A rejected session anywhere in the app is announced once, and AuthProvider reacts. */
export function createClient(
  baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
): StaffClient {
  return createStaffClient({
    baseUrl,
    onUnauthenticated: () => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)),
  });
}
