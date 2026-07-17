import { z } from 'zod';
import { ExperimentalConditionSchema } from './telemetry.types';

// Session/Message previously existed only as backend-local TS interfaces (SessionService.ts)
// with no runtime validation anywhere — sessions.routes.ts did manual `if (!id || !condition)`
// checks. These schemas back the new validateBody() middleware on that route.

export const MessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system', 'tool-result']),
  content: z.string(),
  agentId: z.string().optional(),
  timestamp: z.string(),
});
export type MessageDTO = z.infer<typeof MessageSchema>;

export const SessionCreateSchema = z.object({
  id: z.string().uuid(),
  condition: ExperimentalConditionSchema,
  agentIds: z.array(z.string()).default([]),
  title: z.string().min(1).optional(),
  projectId: z.string().uuid().optional(),
});
export type SessionCreate = z.infer<typeof SessionCreateSchema>;

export const SessionTitleUpdateSchema = z.object({
  title: z.string().min(1),
});
