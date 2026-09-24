import assert from 'node:assert/strict';
import { PythonAgentRuntimeClient } from '../../src/agent-runtime/PythonAgentRuntimeClient.js';

const endpoint = process.env.AGENT_RUNTIME_MCP_URL ?? 'http://127.0.0.1:8001/mcp';

const definition = {
  identity: 'Validate one scoped RTL interface artifact.',
  instructions: {
    version: '1.0.0',
    text: 'Use only declared tools and return structured output.',
  },
  input_schema: {
    type: 'object',
    properties: { artifact: { type: 'string' } },
    required: ['artifact'],
    additionalProperties: false,
  },
  tools: [
    {
      name: 'read_locked_interface',
      description: 'Read the task immutable interface.',
      input_schema: { type: 'object', additionalProperties: false },
      episode_kind: 'exploratory',
    },
  ],
  model_binding: { provider: 'unconfigured', model: 'pending-project-selection' },
  output_schema: {
    type: 'object',
    properties: {
      status: { const: 'complete' },
      findings: { type: 'array', items: { type: 'string' } },
    },
    required: ['status', 'findings'],
    additionalProperties: false,
  },
  memory_scope: 'task-scoped',
  termination_policy: { max_iterations: 2, status_field: 'status', escalation: 'controller' },
  verification_gate_id: 'status-is-complete',
};

const task = {
  id: 'mcp-e2e-task-1',
  input: { artifact: 'rtl/accumulator.sv' },
  scope: { label: 'accumulator', boundaries: { allowed_paths: ['rtl/accumulator.sv'] } },
  locked_interface: { signals: [{ id: 'ready', width: 1 }] },
  instructions: 'Validate locked interface preservation.',
  acceptance_criteria: ['Return complete structured result.'],
  skills: [{ id: 'rtl-interface-validation', version: '1.0.0', content: 'Read interface first.' }],
};

const plan = {
  plan_id: 'mcp-e2e-plan-1',
  tasks: [
    {
      task_id: 'producer',
      scope: 'REQ-PRODUCER',
      locked_interface: { signals: [{ id: 'ready' }] },
      instructions: 'Produce ready.',
      dependencies: [],
      acceptance_criteria: 'gate:producer',
      model_tier: 'standard',
      signal_uses: [
        {
          task_id: 'producer',
          signal_id: 'ready',
          role: 'PRODUCE',
          source_spans: ['spec:1'],
          scope_pointer: 'REQ-PRODUCER',
        },
      ],
    },
    {
      task_id: 'consumer',
      scope: 'REQ-CONSUMER',
      locked_interface: { signals: [{ id: 'ready' }] },
      instructions: 'Consume ready.',
      dependencies: ['producer'],
      acceptance_criteria: 'gate:consumer',
      model_tier: 'standard',
      signal_uses: [
        {
          task_id: 'consumer',
          signal_id: 'ready',
          role: 'CONSUME',
          source_spans: ['spec:2'],
          scope_pointer: 'REQ-CONSUMER',
        },
      ],
    },
  ],
  dependency_proofs: [
    {
      parent_task_id: 'producer',
      child_task_id: 'consumer',
      shared_signal_ids: ['ready'],
      applied_rule: 'PRODUCER_TO_CONSUMER',
      source_spans: ['spec:1', 'spec:2'],
    },
  ],
};

const orchestrationPolicy = {
  policy_id: 'mcp-e2e-orchestration-policy',
  routing_rules: {
    multi_agent_min_categories: 2,
    multi_agent_min_blast_radius: 2,
    multi_agent_gap_types: [],
  },
  skills: [{ id: 'rtl-review', version: '1.0.0', content: 'Review bounded RTL evidence.' }],
  models: [{
    model_key: 'host-standard',
    binding: { provider: 'host', model: 'scripted' },
    allowed_tiers: ['standard'],
  }],
  profiles: [{
    profile_id: 'rtl-reviewer',
    stage: 'rtl-development',
    role: 'rtl-reviewer',
    allowed_skill_ids: ['rtl-review'],
    required_skill_ids: ['rtl-review'],
    allowed_model_keys: ['host-standard'],
    allowed_tool_names: ['read_file'],
    capability_grant: {
      role: 'rtl-reviewer',
      capabilities: ['filesystem.read'],
      allowed_paths: ['.'],
    },
  }],
};

const orchestrationRequest = {
  request_id: 'mcp-e2e-orchestration-request',
  stage: 'rtl-development',
  snapshot: {
    snapshot_id: 'mcp-e2e-orchestration-snapshot',
    version: '1.0.0',
    content_hash: 'mcp-e2e-orchestration-hash',
    artifact_ids: ['spec:rtl'],
    read_only: true,
  },
  gap_metadata: { categories_touched: ['rtl'], blast_radius: 1, gap_types: [] },
  plan: {
    plan_id: 'mcp-e2e-orchestration-plan',
    tasks: [{
      task_id: 'inspect-rtl',
      scope: 'REQ-RTL',
      locked_interface: { signals: [{ id: 'ready' }] },
      instructions: 'Inspect the bounded RTL request.',
      acceptance_criteria: 'gate:inspect-rtl',
      model_tier: 'standard',
    }],
  },
  selected_skill_ids: ['rtl-review'],
  profile_id_by_task_id: { 'inspect-rtl': 'rtl-reviewer' },
};

async function main(): Promise<void> {
  const client = new PythonAgentRuntimeClient({ mcpUrl: endpoint, requestTimeoutMs: 10_000 });
  const toolNames = await client.listTools();
  for (const requiredTool of [
    'assemble_initial_context',
    'run_agent_task',
    'validate_agent_definition',
    'validate_plan',
    'start_run',
    'prepare_orchestration',
    'submit_orchestration_for_approval',
    'approve_orchestration',
    'get_orchestration',
    'cancel_orchestration',
    'get_run_state',
    'cancel_run',
    'submit_approval',
    'resume_run',
    'create_controller',
    'submit_controller_plan',
    'approve_controller_plan',
    'dispatch_controller',
    'record_controller_node_result',
    'publish_exploratory_discovery',
    'request_lateral_dependency',
    'get_shared_state',
    'verify_provenance_contract',
    'process_specification_manifest',
    'select_task_context',
    'validate_gate_one',
    'soft_lock_specification',
    'list_telemetry_runs',
    'get_telemetry_events',
    'get_telemetry_metrics',
    'create_telemetry_report',
    'get_git_repository_state',
    'classify_specification_version',
    'create_specification_git_lock',
    'create_variant_worktree',
  ]) {
    assert.equal(toolNames.includes(requiredTool), true, `Missing MCP tool ${requiredTool}`);
  }

  const definitionValidation = await client.validateAgentDefinition(definition);
  assert.equal(definitionValidation.ok, true);

  const result = await client.runAgentTask(definition, task, {
    mode: 'deterministic',
    scripted_turns: [
      {
        type: 'tool-call',
        call: { id: 'read-1', name: 'read_locked_interface', arguments: {} },
      },
      {
        type: 'final',
        output: { status: 'complete', findings: ['ready is preserved'] },
      },
    ],
  });

  assert.equal(result.ok, true);
  const agentResult = result.result as Record<string, unknown>;
  assert.equal(agentResult.status, 'completed');
  assert.deepEqual(agentResult.output, { status: 'complete', findings: ['ready is preserved'] });

  const telemetryRuns = await client.listTelemetryRuns();
  assert.equal(telemetryRuns.ok, true);
  const observedRuns = telemetryRuns.runs as Array<{ run_id: string }>;
  assert.equal(observedRuns.some((item) => item.run_id === task.id), true);
  const trace = await client.getTelemetryEvents(task.id);
  assert.equal(trace.ok, true);
  const events = trace.events as Array<{ event_type: string }>;
  assert.equal(events.some((event) => event.event_type === 'run.created'), true);
  assert.equal(trace.integrity_chain_valid, true);
  const report = await client.createTelemetryReport(task.id);
  assert.equal(report.ok, true);

  const planValidation = await client.validatePlan(plan);
  assert.equal(planValidation.ok, true);
  assert.equal((planValidation.report as { valid: boolean }).valid, true);

  const started = await client.startRun(plan);
  assert.equal(started.ok, true);
  const run = started.run as { run_id: string; graph: { statuses: Record<string, string> } };
  assert.equal(run.graph.statuses['node:producer'], 'runnable');
  assert.equal(run.graph.statuses['node:consumer'], 'pending');

  const cancelled = await client.cancelRun(run.run_id);
  assert.equal(cancelled.ok, true);
  const cancelledRun = cancelled.run as { cancelled: boolean; graph: { statuses: Record<string, string> } };
  assert.equal(cancelledRun.cancelled, true);
  assert.equal(cancelledRun.graph.statuses['node:producer'], 'cancelled');

  const createdController = await client.createController(
    { snapshot_id: 'spec-v1', version: '1.0.0', content_hash: 'content-hash', read_only: true },
    { stage: 'rtl-development', skill_ids: ['rtl'], capability_ids: ['spec.read'], source_snapshot_id: 'spec-v1', source_read_only: true },
    { multi_agent_min_categories: 2, multi_agent_min_blast_radius: 3, multi_agent_gap_types: ['traceability'] },
    { categories_touched: ['architecture', 'interface'], blast_radius: 0, gap_types: [] },
    1,
  );
  assert.equal(createdController.ok, true);
  const controller = createdController.controller as { controller_id: string; architecture: string };
  assert.equal(controller.architecture, 'multi-agent');

  const presented = await client.submitControllerPlan(controller.controller_id, plan);
  assert.equal(presented.ok, true);
  const approved = await client.approveControllerPlan(controller.controller_id, true, 'Designer approved the bounded plan.');
  assert.equal(approved.ok, true);
  const dispatched = await client.dispatchController(controller.controller_id);
  assert.equal(dispatched.ok, true);
  const controllerRun = dispatched.run as { run_id: string; graph: { statuses: Record<string, string> } };
  assert.equal(controllerRun.graph.statuses['node:producer'], 'runnable');

  const producerResult = await client.recordControllerNodeResult(controller.controller_id, 'node:producer', {
    status: 'completed', output: { status: 'complete' }, artifact_ids: [], diagnostics: [],
  });
  assert.equal(producerResult.ok, true);
  const published = await client.publishExploratoryDiscovery(controller.controller_id, {
    episode_id: 'episode-producer-1',
    producer_node_id: 'node:producer',
    owner_id: 'worker-producer',
    snapshot_id: 'spec-v1',
    snapshot_version: '1.0.0',
    source_spans: ['REQ-PRODUCER#line:4'],
    description: 'Identified a synchronous-reset constraint.',
    payload: { reset: 'synchronous' },
    provenance_hash: 'discovery-hash',
  });
  assert.equal(published.ok, true);
  const lateral = await client.requestLateralDependency(controller.controller_id, {
    consumer_node_id: 'node:consumer',
    consumer_action_id: 'write-rtl',
    discovery_episode_id: 'episode-producer-1',
    reason: 'Preserve reset requirement in downstream RTL.',
  });
  assert.equal(lateral.ok, true);
  const lateralRun = lateral.run as { graph: { edges: Array<{ metadata: Record<string, unknown> }> } };
  assert.equal(lateralRun.graph.edges.some((edge) => edge.metadata.lateral === true), true);

  const preparedOrchestration = await client.prepareOrchestration(
    orchestrationPolicy,
    orchestrationRequest,
  );
  assert.equal(preparedOrchestration.ok, true);
  const orchestration = preparedOrchestration.orchestration as { orchestration_id: string; status: string };
  assert.equal(orchestration.status, 'prepared');
  const fetchedOrchestration = await client.getOrchestration(orchestration.orchestration_id);
  assert.equal(fetchedOrchestration.ok, true);
  const submittedOrchestration = await client.submitOrchestrationForApproval(orchestration.orchestration_id);
  assert.equal(submittedOrchestration.ok, true);
  const approvedOrchestration = await client.approveOrchestration(
    orchestration.orchestration_id,
    true,
    'Designer approved the bounded orchestration plan.',
  );
  assert.equal(approvedOrchestration.ok, true);
  assert.equal((approvedOrchestration.orchestration as { status: string }).status, 'approved');
  const cancelledOrchestration = await client.cancelOrchestration(
    orchestration.orchestration_id,
    'The TypeScript façade has no host-local executable bindings.',
  );
  assert.equal(cancelledOrchestration.ok, true);
  assert.equal(
    (cancelledOrchestration.orchestration as { status: string }).status,
    'cancelled',
  );

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    endpoint,
    tools: toolNames,
    agentStatus: agentResult.status,
    graphStatus: cancelledRun.graph.statuses,
    controllerId: controller.controller_id,
    orchestrationId: orchestration.orchestration_id,
  }));
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
