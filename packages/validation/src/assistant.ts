import { z } from 'zod';

/** Body of a message sent to Ask Assar. Omit `threadId` to start a thread. */
export const sendAssistantMessageSchema = z.object({
  threadId: z.string().optional(),
  body: z.string().trim().min(1).max(2000),
});

export type SendAssistantMessage = z.infer<typeof sendAssistantMessageSchema>;
