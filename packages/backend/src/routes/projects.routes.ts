import { Router, type Request } from 'express';
import multer from 'multer';
import { ProjectService } from '../services/ProjectService';
import { ProjectCreateSchema, ProjectUpdateSchema } from '@agent_design/shared';
import { validateBody } from '../middleware/validation';
import { optionalAuth } from '../middleware/auth';
import { logger } from '../utils/logger';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// "Owner" filter: undefined for unauthenticated or admin callers (unfiltered — today's
// behavior), otherwise the caller's own id (their projects + pre-existing unowned ones).
function ownerFilterFor(req: Request): string | undefined {
  return req.user && req.user.role !== 'admin' ? req.user.id : undefined;
}

export function projectsRouter(projectService: ProjectService): Router {
  const router = Router();
  router.use(optionalAuth);

  // Projects
  router.get('/', async (req, res) => {
    try {
      const projects = await projectService.listProjects(ownerFilterFor(req));
      res.json(projects);
    } catch (err) {
      logger.error('Failed to list projects', err);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const project = await projectService.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get project' });
    }
  });

  router.post('/', validateBody(ProjectCreateSchema), async (req, res) => {
    try {
      const project = await projectService.createProject(req.body, req.user?.id);
      res.json(project);
    } catch (err) {
      logger.error('Failed to create project', err);
      res.status(500).json({ error: 'Failed to create project' });
    }
  });

  router.put('/:id', validateBody(ProjectUpdateSchema), async (req, res) => {
    try {
      const project = await projectService.updateProject(req.params.id, req.body);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.json(project);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update project' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const deleted = await projectService.deleteProject(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Project not found' });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  // Summaries
  router.get('/:projectId/summaries', async (req, res) => {
    try {
      const summaries = await projectService.getSummariesForProject(req.params.projectId);
      res.json(summaries);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get summaries' });
    }
  });

  router.post('/:projectId/summaries', async (req, res) => {
    try {
      const { agentId, summaryText, tokensUsed } = req.body;
      if (!agentId || !summaryText) {
        return res.status(400).json({ error: 'agentId and summaryText required' });
      }
      const summary = await projectService.addSummary({
        projectId: req.params.projectId,
        agentId,
        summaryText,
        tokensUsed: tokensUsed || 0,
      });
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: 'Failed to add summary' });
    }
  });

  // Attachments 
  router.get('/:projectId/attachments', async (req, res) => {
    try {
      const attachments = await projectService.getAttachmentsForProject(req.params.projectId);
      res.json(attachments);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get attachments' });
    }
  });

  router.post('/:projectId/attachments', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const targetPath = req.body.path || req.file.originalname;
      const attachment = await projectService.addAttachment(req.params.projectId, req.file, targetPath);
      res.json(attachment);
    } catch (err) {
      logger.error('Failed to upload attachment', err);
      res.status(500).json({ error: 'Failed to upload attachment' });
    }
  });

  router.delete('/attachments/:id', async (req, res) => {
    try {
      const deleted = await projectService.deleteAttachment(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Attachment not found' });
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete attachment' });
    }
  });

  return router;
}