/** Populated from env at startup; read lazily by @Throttle so decorators needn't know env at import time. */
export const rateLimits = { auth: 10, global: 300 };
export const AUTH_THROTTLE = { default: { limit: () => rateLimits.auth, ttl: 60_000 } };
