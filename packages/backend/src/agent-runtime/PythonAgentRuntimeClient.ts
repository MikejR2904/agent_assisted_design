import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';

/**
 * The TypeScript-to-Python integration boundary. Python owns BaseAgent,
 * controller state, preprocessing, graph scheduling, policy, and memory.
 * TypeScript forwards typed MCP payloads and never duplicates these decisions.
 */
const RuntimeEnvelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  report: z.unknown().optional(),
  run: z.unknown().optional(),
  approval: z.unknown().optional(),
  controller: z.unknown().optional(),
  shared_state: z.unknown().optional(),
  manifest: z.unknown().optional(),
  trees: z.unknown().optional(),
  processed_paths: z.unknown().optional(),
  selection: z.unknown().optional(),
  dependency_graph: z.unknown().optional(),
  gap_report: z.unknown().optional(),
  summary: z.unknown().optional(),
  decision: z.unknown().optional(),
  runs: z.unknown().optional(),
  events: z.unknown().optional(),
  metrics: z.unknown().optional(),
  definitions: z.unknown().optional(),
  definition: z.unknown().optional(),
  observation: z.unknown().optional(),
  repository: z.unknown().optional(),
  orchestration: z.unknown().optional(),
  classification: z.unknown().optional(),
  lock: z.unknown().optional(),
  worktree: z.unknown().optional(),
  integrity_chain_valid: z.boolean().optional(),
  state: z.unknown().optional(),
  errors: z.array(z.object({
    message: z.string(),
    type: z.string().optional(),
    location: z.array(z.union([z.string(), z.number()])).optional(),
  })).optional(),
});

export type PythonAgentRuntimeResponse = z.infer<typeof RuntimeEnvelopeSchema>;

type JsonObject = Record<string, unknown>;

type PythonRuntimeTool =
  | 'validate_agent_definition'
  | 'assemble_initial_context'
  | 'run_agent_task'
  | 'initialize_project_state'
  | 'get_project_state'
  | 'record_human_project_decision'
  | 'open_project_question'
  | 'validate_plan'
  | 'start_run'
  | 'prepare_orchestration'
  | 'submit_orchestration_for_approval'
  | 'approve_orchestration'
  | 'get_orchestration'
  | 'cancel_orchestration'
  | 'get_run_state'
  | 'cancel_run'
  | 'submit_approval'
  | 'resume_run'
  | 'create_controller'
  | 'submit_controller_plan'
  | 'approve_controller_plan'
  | 'dispatch_controller'
  | 'record_controller_node_result'
  | 'publish_exploratory_discovery'
  | 'request_lateral_dependency'
  | 'get_controller_state'
  | 'get_shared_state'
  | 'verify_provenance_contract'
  | 'record_controller_stage_failure'
  | 'complete_controller'
  | 'cancel_controller'
  | 'process_specification_manifest'
  | 'select_task_context'
  | 'validate_gate_one'
  | 'soft_lock_specification'
  | 'list_telemetry_runs'
  | 'get_telemetry_events'
  | 'get_audit_log'
  | 'render_audit_transcript'
  | 'register_metric_definition'
  | 'list_metric_definitions'
  | 'record_metric_observation'
  | 'get_telemetry_metrics'
  | 'create_telemetry_report'
  | 'get_git_repository_state'
  | 'classify_specification_version'
  | 'create_specification_git_lock'
  | 'create_variant_worktree';

export interface PythonAgentRuntimeClientOptions {
  readonly mcpUrl: string;
  readonly requestTimeoutMs?: number;
}

export class PythonAgentRuntimeClient {
  private readonly endpoint: URL;
  private readonly requestTimeoutMs: number;

  constructor(options: PythonAgentRuntimeClientOptions) {
    try {
      this.endpoint = new URL(options.mcpUrl);
    } catch {
      throw new AppError(
        `Invalid Python agent runtime MCP URL: ${options.mcpUrl}`,
        ErrorCategory.CONFIG,
        false,
        'The Python agent runtime URL is invalid.',
      );
    }
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async listTools(): Promise<readonly string[]> {
    return this.withClient(async (client) => {
      const response = await client.listTools();
      return Object.freeze(response.tools.map((tool) => tool.name));
    });
  }

  async validateAgentDefinition(definition: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('validate_agent_definition', { definition });
  }

  async assembleInitialContext(definition: JsonObject, task: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('assemble_initial_context', { definition, task });
  }

  async runAgentTask(
    definition: JsonObject,
    task: JsonObject,
    runtimeOptions: JsonObject = {},
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('run_agent_task', { definition, task, runtime_options: runtimeOptions });
  }

  async initializeProjectState(projectId: string, stageSchema: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('initialize_project_state', {
      project_id: projectId,
      stage_schema: stageSchema,
    });
  }

  async getProjectState(projectId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_project_state', { project_id: projectId });
  }

  async recordHumanProjectDecision(
    projectId: string,
    decisionId: string,
    content: string,
    status: string,
    evidenceId: string,
    sourceSpans: readonly string[] = [],
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('record_human_project_decision', {
      project_id: projectId,
      decision_id: decisionId,
      content,
      status,
      evidence_id: evidenceId,
      source_spans: sourceSpans,
    });
  }

  async openProjectQuestion(
    projectId: string,
    questionId: string,
    content: string,
    owner: 'human' | 'controller',
    evidenceId: string,
    sourceSpans: readonly string[] = [],
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('open_project_question', {
      project_id: projectId,
      question_id: questionId,
      content,
      owner,
      evidence_id: evidenceId,
      source_spans: sourceSpans,
    });
  }

  async validatePlan(plan: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('validate_plan', { plan });
  }

  async startRun(plan: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('start_run', { plan });
  }

  async prepareOrchestration(
    policy: JsonObject,
    request: JsonObject,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('prepare_orchestration', { policy, request });
  }

  async submitOrchestrationForApproval(orchestrationId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('submit_orchestration_for_approval', {
      orchestration_id: orchestrationId,
    });
  }

  async approveOrchestration(
    orchestrationId: string,
    approved: boolean,
    reason?: string,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('approve_orchestration', {
      orchestration_id: orchestrationId,
      approved,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  async getOrchestration(orchestrationId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_orchestration', { orchestration_id: orchestrationId });
  }

  async cancelOrchestration(
    orchestrationId: string,
    reason: string,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('cancel_orchestration', {
      orchestration_id: orchestrationId,
      reason,
    });
  }

  async getRunState(runId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_run_state', { run_id: runId });
  }

  async cancelRun(runId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('cancel_run', { run_id: runId });
  }

  async submitApproval(runId: string, approvalId: string, approved: boolean, reason?: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('submit_approval', {
      run_id: runId,
      approval_id: approvalId,
      approved,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  async resumeRun(runId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('resume_run', { run_id: runId });
  }

  async createController(
    snapshot: JsonObject,
    profile: JsonObject,
    routingRules: JsonObject,
    gapMetadata: JsonObject,
    maxRepairAttempts = 1,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('create_controller', {
      snapshot,
      profile,
      routing_rules: routingRules,
      gap_metadata: gapMetadata,
      max_repair_attempts: maxRepairAttempts,
    });
  }

  async submitControllerPlan(controllerId: string, plan: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('submit_controller_plan', { controller_id: controllerId, plan });
  }

  async approveControllerPlan(controllerId: string, approved: boolean, reason?: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('approve_controller_plan', {
      controller_id: controllerId,
      approved,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  async dispatchController(controllerId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('dispatch_controller', { controller_id: controllerId });
  }

  async recordControllerNodeResult(
    controllerId: string,
    nodeId: string,
    result: JsonObject,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('record_controller_node_result', {
      controller_id: controllerId,
      node_id: nodeId,
      result,
    });
  }

  async publishExploratoryDiscovery(controllerId: string, discovery: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('publish_exploratory_discovery', { controller_id: controllerId, discovery });
  }

  async requestLateralDependency(controllerId: string, request: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('request_lateral_dependency', { controller_id: controllerId, request });
  }

  async getControllerState(controllerId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_controller_state', { controller_id: controllerId });
  }

  async getSharedState(controllerId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_shared_state', { controller_id: controllerId });
  }

  async verifyProvenanceContract(
    controllerId: string,
    records: readonly JsonObject[],
    requiredSchemaVersion: string,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('verify_provenance_contract', {
      controller_id: controllerId,
      records,
      required_schema_version: requiredSchemaVersion,
    });
  }

  async recordControllerStageFailure(controllerId: string, reason: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('record_controller_stage_failure', { controller_id: controllerId, reason });
  }

  async completeController(controllerId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('complete_controller', { controller_id: controllerId });
  }

  async cancelController(controllerId: string, reason: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('cancel_controller', { controller_id: controllerId, reason });
  }

  async processSpecificationManifest(manifestPath = 'specification-manifest.yaml'): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('process_specification_manifest', { manifest_path: manifestPath });
  }

  async selectTaskContext(
    trees: readonly JsonObject[],
    stage: string,
    taskText: string,
    scopePointers: readonly string[] = [],
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('select_task_context', {
      trees,
      stage,
      task_text: taskText,
      scope_pointers: scopePointers,
    });
  }

  async validateGateOne(specification: JsonObject, requiredCategories: readonly string[]): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('validate_gate_one', {
      specification,
      required_categories: requiredCategories,
    });
  }

  async softLockSpecification(
    specification: JsonObject,
    dependencyGraph: JsonObject,
    gapReport: JsonObject,
    metadata: JsonObject,
    userApproved: boolean,
    proceedWithGaps = false,
    plans: readonly JsonObject[] = [],
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('soft_lock_specification', {
      specification,
      dependency_graph: dependencyGraph,
      gap_report: gapReport,
      metadata,
      user_approved: userApproved,
      proceed_with_gaps: proceedWithGaps,
      plans,
    });
  }

  async listTelemetryRuns(limit = 100): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('list_telemetry_runs', { limit });
  }

  async getTelemetryEvents(runId: string, afterSequence = 0, limit = 250): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_telemetry_events', {
      run_id: runId,
      after_sequence: afterSequence,
      limit,
    });
  }

  async getAuditLog(runId: string, limit = 1000): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_audit_log', { run_id: runId, limit });
  }

  async renderAuditTranscript(runId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('render_audit_transcript', { run_id: runId });
  }

  async registerMetricDefinition(definition: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('register_metric_definition', { definition });
  }

  async listMetricDefinitions(): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('list_metric_definitions', {});
  }

  async recordMetricObservation(observation: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('record_metric_observation', { observation });
  }

  async getTelemetryMetrics(runId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_telemetry_metrics', { run_id: runId });
  }

  async createTelemetryReport(runId: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('create_telemetry_report', { run_id: runId });
  }

  async getGitRepositoryState(repositoryPath: string): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('get_git_repository_state', { repository_path: repositoryPath });
  }

  async classifySpecificationVersion(
    repositoryPath: string,
    version: string,
    specification: JsonObject,
    dependencyGraph: JsonObject,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('classify_specification_version', {
      repository_path: repositoryPath,
      version,
      specification,
      dependency_graph: dependencyGraph,
    });
  }

  async createSpecificationGitLock(
    repositoryPath: string,
    specification: JsonObject,
    dependencyGraph: JsonObject,
    gapReport: JsonObject,
    metadata: JsonObject,
    approval: JsonObject,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('create_specification_git_lock', {
      repository_path: repositoryPath,
      specification,
      dependency_graph: dependencyGraph,
      gap_report: gapReport,
      metadata,
      approval,
    });
  }

  async createVariantWorktree(
    repositoryPath: string,
    name: string,
    branch: string,
    baseRef: string,
    specificationTag: string,
    purpose: string,
    approval: JsonObject,
  ): Promise<PythonAgentRuntimeResponse> {
    return this.callPythonTool('create_variant_worktree', {
      repository_path: repositoryPath,
      name,
      branch,
      base_ref: baseRef,
      specification_tag: specificationTag,
      purpose,
      approval,
    });
  }

  private async callPythonTool(name: PythonRuntimeTool, arguments_: JsonObject): Promise<PythonAgentRuntimeResponse> {
    return this.withClient(async (client) => {
      let response: Awaited<ReturnType<typeof client.callTool>>;
      try {
        response = await client.callTool(
          { name, arguments: arguments_ },
          undefined,
          { timeout: this.requestTimeoutMs },
        );
      } catch (error) {
        throw this.toNetworkError(`MCP call to Python tool "${name}" failed`, error);
      }

      if (response.isError) {
        const content = Array.isArray(response.content) ? response.content : [];
        const message = content
          .map((block) => isTextContent(block) ? block.text : '')
          .filter(Boolean)
          .join('\n') || `Python tool "${name}" reported an MCP error.`;
        throw new AppError(message, ErrorCategory.VALIDATION, false, 'The Python agent runtime rejected the request.');
      }

      const parsed = RuntimeEnvelopeSchema.safeParse(response.structuredContent);
      if (!parsed.success) {
        throw new AppError(
          `Python tool "${name}" returned an invalid result envelope: ${parsed.error.message}`,
          ErrorCategory.NETWORK,
          false,
          'The Python agent runtime returned an invalid response.',
        );
      }
      return parsed.data;
    });
  }

  private async withClient<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ name: 'agent-design-backend', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(this.endpoint);

    try {
      await client.connect(transport, { timeout: this.requestTimeoutMs });
      return await operation(client);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.toNetworkError('Could not connect to the Python agent runtime', error);
    } finally {
      await transport.close().catch(() => undefined);
    }
  }

  private toNetworkError(prefix: string, error: unknown): AppError {
    const detail = error instanceof Error ? error.message : String(error);
    return new AppError(
      `${prefix}: ${detail}`,
      ErrorCategory.NETWORK,
      true,
      'The Python agent runtime is unavailable. Please retry after it starts.',
    );
  }
}

function isTextContent(value: unknown): value is { type: 'text'; text: string } {
  return typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'text'
    && typeof (value as { text?: unknown }).text === 'string';
}
