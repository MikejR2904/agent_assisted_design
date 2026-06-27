import { z } from 'zod';

export const AttachmentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().optional(),
  name: z.string().min(1),
  path: z.string().optional(), // relative path within project workspace
  contentType: z.string().optional(),
  size: z.number().int().min(0),
  uploadedAt: z.string().datetime(),
});

export type Attachment = z.infer<typeof AttachmentSchema>;

export const AttachmentCreateSchema = AttachmentSchema.omit({ id: true, uploadedAt: true });
export type AttachmentCreate = z.infer<typeof AttachmentCreateSchema>;