import { z } from 'zod';
import { ExperimentalConditionSchema } from './telemetry.types';

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  condition: ExperimentalConditionSchema.default('agent-assisted'),
  workspaceDir: z.string(),
  sessionIds: z.array(z.string().uuid()).default([]),
  agentIds: z.array(z.string().uuid()).default([]),
  skillFiles: z.array(z.string()).default([]), // paths to .md files
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  color: z.string().regex(/^#([0-9a-f]{6})$/i).optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectCreateSchema = ProjectSchema.pick({
  name: true,
  description: true,
  condition: true,
}).partial({ condition: true });
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;