import assert from 'node:assert/strict';
import { PythonAgentRuntimeClient } from '../../src/agent-runtime/PythonAgentRuntimeClient.js';

const runtime = new PythonAgentRuntimeClient({
  mcpUrl: process.env.AGENT_RUNTIME_MCP_URL ?? 'http://127.0.0.1:8011/mcp',
  requestTimeoutMs: 10_000,
});

const definition = {
  identity: 'Validate one scoped RTL interface artifact.',
  instructions: { version: '1.0.0', text: 'Use only declared tools and return structured output.' },
  input_schema: {
    type: 'object',
    properties: { artifact: { type: 'string' } },
    required: ['artifact'],
    additionalProperties: false,
  },
  tools: [
    {
      name: 'read_locked_interface',
      description: 'Read the task locked interface.',
      input_schema: { type: 'object', additionalProperties: false },
      episode_kind: 'exploratory',
      concurrency: 'parallel-safe',
    },
    {
      name: 'echo',
      description: 'Return deterministic arguments.',
      input_schema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
      episode_kind: 'action',
    },
  ],
  model_binding: { provider: 'unconfigured', model: 'pending-project-selection' },
  output_schema: {
    type: 'object',
    properties: { status: { const: 'complete' }, findings: { type: 'array', items: { type: 'string' } } },
    required: ['status', 'findings'],
    additionalProperties: false,
  },
  memory_scope: 'task-scoped',
  termination_policy: { max_iterations: 3, status_field: 'status', escalation: 'controller' },
};
const task = {
  id: 'ts-batch-context-task',
  input: { artifact: 'rtl/accumulator.sv' },
  scope: { label: 'accumulator', boundaries: { allowed_paths: ['rtl/accumulator.sv'] } },
  locked_interface: { signals: [{ id: 'ready', width: 1 }] },
  instructions: 'Validate selected artifact.',
  acceptance_criteria: ['Return complete structured result.'],
  skills: [],
};

async function main(): Promise<void> {
  const taskWithProject = {
    ...task,
    scope: {
      ...task.scope,
      boundaries: { ...task.scope.boundaries, project_id: `ts-batch-project-${process.pid}` },
    },
  };
  const response = await runtime.runAgentTask(definition, taskWithProject, {
    mode: 'deterministic',
    context_token_budget: 4_000,
    episode_token_budget: 2_000,
    tool_result_preview_chars: 64,
    scripted_turns: [
      {
        type: 'tool-batch',
        calls: [
          { id: 'read-a', name: 'read_locked_interface', arguments: {} },
          { id: 'read-b', name: 'read_locked_interface', arguments: {} },
          {
            id: 'echo-c',
            name: 'echo',
            arguments: { value: 'verified' },
            depends_on_call_ids: ['read-a', 'read-b'],
          },
        ],
      },
      { type: 'final', output: { status: 'complete', findings: ['batched context projected'] } },
    ],
  });

  assert.equal(response.ok, true);
  const result = response.result as {
    status: string;
    projection_history: Array<{ context_token_budget: number }>;
    events: Array<{ type: string }>;
    project_state: { revision: number; last_action: { action_id: string } };
    profile: { integrity_hash: string; spans: Array<{ kind: string }> };
  };
  assert.equal(result.status, 'completed');
  assert.equal(result.projection_history[1].context_token_budget, 4_000);
  assert.ok(result.events.some((event) => event.type === 'tool-batch-completed'));
  assert.equal(result.project_state.revision, 4);
  assert.equal(result.project_state.last_action.action_id, 'agent-result:ts-batch-context-task');
  assert.ok(result.profile.integrity_hash);
  assert.ok(result.profile.spans.some((span) => span.kind === 'model-turn'));
  assert.ok(result.profile.spans.some((span) => span.kind === 'tool'));
  const metrics = await runtime.getTelemetryMetrics(taskWithProject.id);
  const audit = await runtime.getAuditLog(taskWithProject.id);
  const transcript = await runtime.renderAuditTranscript(taskWithProject.id);
  assert.ok((metrics.metrics as Array<{ metric_id: string }>).some(
    (metric) => metric.metric_id === 'agent.model_turn_attempt_count',
  ));
  assert.ok((audit.events as Array<{ event_type: string }>).some(
    (event) => event.event_type === 'model-turn',
  ));
  assert.equal((transcript.report as { integrity_chain_valid: boolean }).integrity_chain_valid, true);
  const projectId = `ts-state-project-${process.pid}`;
  const initialized = await runtime.initializeProjectState(projectId, {
    schema_id: 'rtl-v1',
    stage: 'rtl-development',
  });
  const decision = await runtime.recordHumanProjectDecision(
    projectId,
    'D-001',
    'Use AXI4-Lite.',
    'locked',
    'REQ-AXI#line:1',
  );
  const state = await runtime.getProjectState(projectId);
  assert.equal((initialized.state as { revision: number }).revision, 0);
  assert.equal((decision.state as { revision: number }).revision, 1);
  assert.equal((state.state as { decisions: Array<{ status: string }> }).decisions[0].status, 'locked');
  console.log(JSON.stringify({ status: result.status, projections: result.projection_history.length }));
}

void main();
