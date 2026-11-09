import type { AssistantRoute } from '@assar/types';

/** Outside intents, checked before any in-product route. */
const OUTSIDE_INTENT =
  /\bweather\b|\bnews\b|\bpoems?\b|\bpoetry\b|\bhomework\b|\bgeneral law\b|\bother compan(?:y|ies)\b|ignore your instructions/i;

/** Tool verbs. Only a leading verb is an action. */
const ACTION_VERB = /^\s*(create|add|schedule|issue|record)\b/i;

/** A count, a name, a status, or the phrase "show my". */
const LOOKUP =
  /\bhow many\b|\bcount\b|\bnumber of\b|\bnames?\b|\bstatus(?:es)?\b|\bshow\s+my\b/i;

export function classify(body: string): AssistantRoute {
  if (OUTSIDE_INTENT.test(body)) return 'refuse';
  if (ACTION_VERB.test(body)) return 'action';
  if (LOOKUP.test(body)) return 'lookup';
  return 'help';
}
