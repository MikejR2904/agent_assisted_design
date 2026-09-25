import { Router } from 'express';
import { z } from 'zod';
import { PythonAgentRuntimeClient } from '../agent-runtime/PythonAgentRuntimeClient';
import { ConfigManager } from '../config/ConfigManager';

const JsonObjectSchema = z.record(z.unknown());
const StringArraySchema = z.array(z.string().min(1));
const DefinitionRequestSchema = z.object({ definition: JsonObjectSchema });
const ContextRequestSchema = z.object({ definition: JsonObjectSchema, task: JsonObjectSchema });
const RuntimeOptionsSchema = z.object({
  mode: z.literal('deterministic').optional(),
  scripted_turns: z.array(z.unknown()).optional(),
  run_deadline_seconds: z.number().positive().max(86_400).optional(),
  model_turn_timeout_seconds: z.number().positive().max(86_400).optional(),
  tool_call_timeout_seconds: z.number().positive().max(86_400).optional(),
  verification_timeout_seconds: z.number().positive().max(86_400).optional(),
  context_token_budget: z.number().int().min(256).max(1_000_000).optional(),
  episode_token_budget: z.number().int().min(0).max(1_000_000).optional(),
  tool_result_preview_chars: z.number().int().min(32).max(100_000).optional(),
  project_state_token_budget: z.number().int().min(128).max(1_000_000).optional(),
}).strict();
const RunTaskRequestSchema = ContextRequestSchema.extend({ runtimeOptions: RuntimeOptionsSchema.default({}) });
const ProjectIdRequestSchema = z.object({ projectId: z.string().min(1) });
const ProjectStateInitializationSchema = z.object({
  projectId: z.string().min(1),
  stageSchema: JsonObjectSchema,
});
const HumanProjectDecisionSchema = z.object({
  decisionId: z.string().min(1),
  content: z.string().min(1).max(4096),
  status: z.enum(['open', 'locked', 'superseded']),
  evidenceId: z.string().min(1),
  sourceSpans: StringArraySchema.default([]),
});
const ProjectQuestionSchema = z.object({
  questionId: z.string().min(1),
  content: z.string().min(1).max(4096),
  owner: z.enum(['human', 'controller']),
  evidenceId: z.string().min(1),
  sourceSpans: StringArraySchema.default([]),
});
const PlanRequestSchema = z.object({ plan: JsonObjectSchema });
const OrchestrationPrepareRequestSchema = z.object({
  policy: JsonObjectSchema,
  request: JsonObjectSchema,
});
const OrchestrationIdRequestSchema = z.object({ orchestrationId: z.string().min(1) });
const OrchestrationApprovalRequestSchema = z.object({
  orchestrationId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().min(1).optional(),
});
const OrchestrationReasonRequestSchema = z.object({
  orchestrationId: z.string().min(1),
  reason: z.string().min(1),
});
const RunIdRequestSchema = z.object({ runId: z.string().min(1) });
const ApprovalRequestSchema = z.object({
  runId: z.string().min(1),
  approvalId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().min(1).optional(),
});
const ControllerCreateRequestSchema = z.object({
  snapshot: JsonObjectSchema,
  profile: JsonObjectSchema,
  routingRules: JsonObjectSchema,
  gapMetadata: JsonObjectSchema,
  maxRepairAttempts: z.number().int().min(0).default(1),
});
const ControllerIdRequestSchema = z.object({ controllerId: z.string().min(1) });
const ControllerPlanRequestSchema = z.object({ controllerId: z.string().min(1), plan: JsonObjectSchema });
const ControllerApprovalRequestSchema = z.object({
  controllerId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().min(1).optional(),
});
const ControllerNodeResultRequestSchema = z.object({
  controllerId: z.string().min(1),
  nodeId: z.string().min(1),
  result: JsonObjectSchema,
});
const ControllerPayloadRequestSchema = z.object({ controllerId: z.string().min(1), payload: JsonObjectSchema });
const ProvenanceContractRequestSchema = z.object({
  controllerId: z.string().min(1),
  records: z.array(JsonObjectSchema).min(1),
  requiredSchemaVersion: z.string().min(1),
});
const ControllerReasonRequestSchema = z.object({ controllerId: z.string().min(1), reason: z.string().min(1) });
const ProcessManifestRequestSchema = z.object({ manifestPath: z.string().min(1).default('specification-manifest.yaml') });
const SelectContextRequestSchema = z.object({
  trees: z.array(JsonObjectSchema),
  stage: z.string().min(1),
  taskText: z.string().min(1),
  scopePointers: StringArraySchema.default([]),
});
const GateOneRequestSchema = z.object({
  specification: JsonObjectSchema,
  requiredCategories: StringArraySchema,
  semanticFindings: z.array(JsonObjectSchema).max(64).default([]),
});
const SoftLockRequestSchema = z.object({
  specification: JsonObjectSchema,
  dependencyGraph: JsonObjectSchema,
  gapReport: JsonObjectSchema,
  metadata: JsonObjectSchema,
  userApproved: z.boolean(),
  proceedWithGaps: z.boolean().default(false),
  plans: z.array(JsonObjectSchema).default([]),
});
const TelemetryListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) });
const TelemetryEventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(250),
});
const RuntimeRunIdSchema = z.object({ runId: z.string().min(1) });
const MetricDefinitionRequestSchema = z.object({ definition: JsonObjectSchema });
const MetricObservationRequestSchema = z.object({ observation: JsonObjectSchema });
const RepositoryQuerySchema = z.object({ repositoryPath: z.string().min(1) });
const VersionClassificationRequestSchema = z.object({
  repositoryPath: z.string().min(1),
  version: z.string().min(1),
  specification: JsonObjectSchema,
  dependencyGraph: JsonObjectSchema,
});
const GitLockRequestSchema = z.object({
  repositoryPath: z.string().min(1),
  specification: JsonObjectSchema,
  dependencyGraph: JsonObjectSchema,
  gapReport: JsonObjectSchema,
  metadata: JsonObjectSchema,
  approval: JsonObjectSchema,
});
const WorktreeRequestSchema = z.object({
  repositoryPath: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1),
  baseRef: z.string().min(1),
  specificationTag: z.string().min(1),
  purpose: z.string().min(1),
  approval: JsonObjectSchema,
});

/**
 * HTTP façade for the Python-owned agent runtime and deterministic harness.
 * It forwards typed MCP payloads; TypeScript never reimplements controller,
 * document parsing, plan validation, graph scheduling, or memory semantics.
 */
export function agentRuntimeRouter(client?: PythonAgentRuntimeClient): Router {
  const router = Router();
  const config = ConfigManager.getInstance().get().agentRuntime;
  const runtime = client ?? new PythonAgentRuntimeClient({
    mcpUrl: config.mcpUrl,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  router.get('/tools', async (_req, res, next) => {
    try { res.json({ tools: await runtime.listTools() }); } catch (error) { next(error); }
  });

  router.post('/validate-definition', async (req, res, next) => {
    const parsed = DefinitionRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.validateAgentDefinition(parsed.data.definition)); } catch (error) { next(error); }
  });

  router.post('/assemble-context', async (req, res, next) => {
    const parsed = ContextRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.assembleInitialContext(parsed.data.definition, parsed.data.task)); } catch (error) { next(error); }
  });

  router.post('/run-task', async (req, res, next) => {
    const parsed = RunTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.runAgentTask(parsed.data.definition, parsed.data.task, parsed.data.runtimeOptions)); } catch (error) { next(error); }
  });

  router.post('/project-state', async (req, res, next) => {
    const parsed = ProjectStateInitializationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.initializeProjectState(parsed.data.projectId, parsed.data.stageSchema)); } catch (error) { next(error); }
  });

  router.get('/project-state/:projectId', async (req, res, next) => {
    const parsed = ProjectIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.getProjectState(parsed.data.projectId)); } catch (error) { next(error); }
  });

  router.post('/project-state/:projectId/decisions', async (req, res, next) => {
    const project = ProjectIdRequestSchema.safeParse(req.params);
    const body = HumanProjectDecisionSchema.safeParse(req.body);
    if (!project.success) return res.status(400).json({ error: project.error.issues });
    if (!body.success) return res.status(400).json({ error: body.error.issues });
    try {
      res.json(await runtime.recordHumanProjectDecision(
        project.data.projectId,
        body.data.decisionId,
        body.data.content,
        body.data.status,
        body.data.evidenceId,
        body.data.sourceSpans,
      ));
    } catch (error) { next(error); }
  });

  router.post('/project-state/:projectId/questions', async (req, res, next) => {
    const project = ProjectIdRequestSchema.safeParse(req.params);
    const body = ProjectQuestionSchema.safeParse(req.body);
    if (!project.success) return res.status(400).json({ error: project.error.issues });
    if (!body.success) return res.status(400).json({ error: body.error.issues });
    try {
      res.json(await runtime.openProjectQuestion(
        project.data.projectId,
        body.data.questionId,
        body.data.content,
        body.data.owner,
        body.data.evidenceId,
        body.data.sourceSpans,
      ));
    } catch (error) { next(error); }
  });

  router.post('/validate-plan', async (req, res, next) => {
    const parsed = PlanRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.validatePlan(parsed.data.plan)); } catch (error) { next(error); }
  });

  router.post('/runs', async (req, res, next) => {
    const parsed = PlanRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.startRun(parsed.data.plan)); } catch (error) { next(error); }
  });

  router.post('/orchestrations', async (req, res, next) => {
    const parsed = OrchestrationPrepareRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.prepareOrchestration(parsed.data.policy, parsed.data.request)); } catch (error) { next(error); }
  });

  router.get('/orchestrations/:orchestrationId', async (req, res, next) => {
    const parsed = OrchestrationIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.getOrchestration(parsed.data.orchestrationId)); } catch (error) { next(error); }
  });

  router.post('/orchestrations/:orchestrationId/submit-for-approval', async (req, res, next) => {
    const parsed = OrchestrationIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.submitOrchestrationForApproval(parsed.data.orchestrationId)); } catch (error) { next(error); }
  });

  router.post('/orchestrations/:orchestrationId/approval', async (req, res, next) => {
    const parsed = OrchestrationApprovalRequestSchema.safeParse({ orchestrationId: req.params.orchestrationId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.approveOrchestration(parsed.data.orchestrationId, parsed.data.approved, parsed.data.reason)); } catch (error) { next(error); }
  });

  router.post('/orchestrations/:orchestrationId/cancel', async (req, res, next) => {
    const parsed = OrchestrationReasonRequestSchema.safeParse({ orchestrationId: req.params.orchestrationId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.cancelOrchestration(parsed.data.orchestrationId, parsed.data.reason)); } catch (error) { next(error); }
  });

  router.get('/runs/:runId', async (req, res, next) => {
    const parsed = RunIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.getRunState(parsed.data.runId)); } catch (error) { next(error); }
  });

  router.post('/runs/:runId/cancel', async (req, res, next) => {
    const parsed = RunIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.cancelRun(parsed.data.runId)); } catch (error) { next(error); }
  });

  router.post('/runs/:runId/resume', async (req, res, next) => {
    const parsed = RunIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.resumeRun(parsed.data.runId)); } catch (error) { next(error); }
  });

  router.post('/runs/:runId/approvals/:approvalId', async (req, res, next) => {
    const parsed = ApprovalRequestSchema.safeParse({ runId: req.params.runId, approvalId: req.params.approvalId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.submitApproval(parsed.data.runId, parsed.data.approvalId, parsed.data.approved, parsed.data.reason)); } catch (error) { next(error); }
  });

  router.post('/controllers', async (req, res, next) => {
    const parsed = ControllerCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.createController(parsed.data.snapshot, parsed.data.profile, parsed.data.routingRules, parsed.data.gapMetadata, parsed.data.maxRepairAttempts)); } catch (error) { next(error); }
  });

  router.get('/controllers/:controllerId', async (req, res, next) => {
    const parsed = ControllerIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.getControllerState(parsed.data.controllerId)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/plan', async (req, res, next) => {
    const parsed = ControllerPlanRequestSchema.safeParse({ controllerId: req.params.controllerId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.submitControllerPlan(parsed.data.controllerId, parsed.data.plan)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/plan-approval', async (req, res, next) => {
    const parsed = ControllerApprovalRequestSchema.safeParse({ controllerId: req.params.controllerId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.approveControllerPlan(parsed.data.controllerId, parsed.data.approved, parsed.data.reason)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/dispatch', async (req, res, next) => {
    const parsed = ControllerIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.dispatchController(parsed.data.controllerId)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/nodes/:nodeId/result', async (req, res, next) => {
    const parsed = ControllerNodeResultRequestSchema.safeParse({ controllerId: req.params.controllerId, nodeId: req.params.nodeId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.recordControllerNodeResult(parsed.data.controllerId, parsed.data.nodeId, parsed.data.result)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/discoveries', async (req, res, next) => {
    const parsed = ControllerPayloadRequestSchema.safeParse({ controllerId: req.params.controllerId, payload: req.body.discovery });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.publishExploratoryDiscovery(parsed.data.controllerId, parsed.data.payload)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/lateral-dependencies', async (req, res, next) => {
    const parsed = ControllerPayloadRequestSchema.safeParse({ controllerId: req.params.controllerId, payload: req.body.request });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.requestLateralDependency(parsed.data.controllerId, parsed.data.payload)); } catch (error) { next(error); }
  });

  router.get('/controllers/:controllerId/shared-state', async (req, res, next) => {
    const parsed = ControllerIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.getSharedState(parsed.data.controllerId)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/provenance-contract', async (req, res, next) => {
    const parsed = ProvenanceContractRequestSchema.safeParse({ controllerId: req.params.controllerId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.verifyProvenanceContract(parsed.data.controllerId, parsed.data.records, parsed.data.requiredSchemaVersion)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/failure', async (req, res, next) => {
    const parsed = ControllerReasonRequestSchema.safeParse({ controllerId: req.params.controllerId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.recordControllerStageFailure(parsed.data.controllerId, parsed.data.reason)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/complete', async (req, res, next) => {
    const parsed = ControllerIdRequestSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.completeController(parsed.data.controllerId)); } catch (error) { next(error); }
  });

  router.post('/controllers/:controllerId/cancel', async (req, res, next) => {
    const parsed = ControllerReasonRequestSchema.safeParse({ controllerId: req.params.controllerId, ...req.body });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.cancelController(parsed.data.controllerId, parsed.data.reason)); } catch (error) { next(error); }
  });

  router.post('/specifications/process', async (req, res, next) => {
    const parsed = ProcessManifestRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.processSpecificationManifest(parsed.data.manifestPath)); } catch (error) { next(error); }
  });

  router.post('/specifications/select-context', async (req, res, next) => {
    const parsed = SelectContextRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.selectTaskContext(parsed.data.trees, parsed.data.stage, parsed.data.taskText, parsed.data.scopePointers)); } catch (error) { next(error); }
  });

  router.post('/specifications/gate-one/validate', async (req, res, next) => {
    const parsed = GateOneRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try {
      res.json(await runtime.validateGateOne(
        parsed.data.specification,
        parsed.data.requiredCategories,
        parsed.data.semanticFindings,
      ));
    } catch (error) { next(error); }
  });

  router.post('/specifications/gate-one/soft-lock', async (req, res, next) => {
    const parsed = SoftLockRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.softLockSpecification(parsed.data.specification, parsed.data.dependencyGraph, parsed.data.gapReport, parsed.data.metadata, parsed.data.userApproved, parsed.data.proceedWithGaps, parsed.data.plans)); } catch (error) { next(error); }
  });

  router.get('/telemetry/runs', async (req, res, next) => {
    const parsed = TelemetryListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.listTelemetryRuns(parsed.data.limit)); } catch (error) { next(error); }
  });

  router.get('/telemetry/runs/:runId/events', async (req, res, next) => {
    const params = RuntimeRunIdSchema.safeParse(req.params);
    const query = TelemetryEventsQuerySchema.safeParse(req.query);
    if (!params.success) return res.status(400).json({ error: params.error.issues });
    if (!query.success) return res.status(400).json({ error: query.error.issues });
    try { res.json(await runtime.getTelemetryEvents(params.data.runId, query.data.afterSequence, query.data.limit)); } catch (error) { next(error); }
  });

  router.get('/audit/runs/:runId', async (req, res, next) => {
    const params = RuntimeRunIdSchema.safeParse(req.params);
    const query = TelemetryEventsQuerySchema.safeParse(req.query);
    if (!params.success) return res.status(400).json({ error: params.error.issues });
    if (!query.success) return res.status(400).json({ error: query.error.issues });
    try { res.json(await runtime.getAuditLog(params.data.runId, query.data.limit)); } catch (error) { next(error); }
  });

  router.post('/audit/runs/:runId/transcript', async (req, res, next) => {
    const parsed = RuntimeRunIdSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.renderAuditTranscript(parsed.data.runId)); } catch (error) { next(error); }
  });

  router.get('/telemetry/runs/:runId/metrics', async (req, res, next) => {
    const parsed = RuntimeRunIdSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.getTelemetryMetrics(parsed.data.runId)); } catch (error) { next(error); }
  });

  router.post('/telemetry/runs/:runId/report', async (req, res, next) => {
    const parsed = RuntimeRunIdSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.createTelemetryReport(parsed.data.runId)); } catch (error) { next(error); }
  });

  router.get('/telemetry/metric-definitions', async (_req, res, next) => {
    try { res.json(await runtime.listMetricDefinitions()); } catch (error) { next(error); }
  });

  router.post('/telemetry/metric-definitions', async (req, res, next) => {
    const parsed = MetricDefinitionRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.registerMetricDefinition(parsed.data.definition)); } catch (error) { next(error); }
  });

  router.post('/telemetry/metric-observations', async (req, res, next) => {
    const parsed = MetricObservationRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.recordMetricObservation(parsed.data.observation)); } catch (error) { next(error); }
  });

  router.get('/git-repositories/state', async (req, res, next) => {
    const parsed = RepositoryQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.json(await runtime.getGitRepositoryState(parsed.data.repositoryPath)); } catch (error) { next(error); }
  });

  router.post('/git-repositories/classify-version', async (req, res, next) => {
    const parsed = VersionClassificationRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try {
      res.json(await runtime.classifySpecificationVersion(
        parsed.data.repositoryPath,
        parsed.data.version,
        parsed.data.specification,
        parsed.data.dependencyGraph,
      ));
    } catch (error) { next(error); }
  });

  router.post('/git-repositories/specification-locks', async (req, res, next) => {
    const parsed = GitLockRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.createSpecificationGitLock(parsed.data.repositoryPath, parsed.data.specification, parsed.data.dependencyGraph, parsed.data.gapReport, parsed.data.metadata, parsed.data.approval)); } catch (error) { next(error); }
  });

  router.post('/git-repositories/worktrees', async (req, res, next) => {
    const parsed = WorktreeRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    try { res.status(201).json(await runtime.createVariantWorktree(parsed.data.repositoryPath, parsed.data.name, parsed.data.branch, parsed.data.baseRef, parsed.data.specificationTag, parsed.data.purpose, parsed.data.approval)); } catch (error) { next(error); }
  });

  return router;
}
