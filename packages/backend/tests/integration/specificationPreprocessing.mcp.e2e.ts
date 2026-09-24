import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PythonAgentRuntimeClient } from '../../src/agent-runtime/PythonAgentRuntimeClient.js';

const endpoint = process.env.AGENT_RUNTIME_MCP_URL ?? 'http://127.0.0.1:8011/mcp';
const specificationRoot = process.env.AGENT_SPECIFICATION_ROOT ?? '/tmp/agent-sdk-coordination-run/specifications';

async function main(): Promise<void> {
  await mkdir(join(specificationRoot, 'functional'), { recursive: true });
  await mkdir(join(specificationRoot, 'architecture'), { recursive: true });
  await writeFile(join(specificationRoot, 'functional', 'requirements.md'), '# Accumulator\nThe accumulator exposes a ready signal.\n');
  await writeFile(join(specificationRoot, 'architecture', 'clocking.txt'), 'The accumulator uses one synchronous clock domain.\n');
  await writeFile(join(specificationRoot, 'specification-manifest.yaml'), [
    'documents:',
    '  - id: REQ-FUNC-001',
    '    title: Functional requirements',
    '    format: md',
    '    path: functional/requirements.md',
    '    category: functional',
    '  - id: REQ-ARCH-001',
    '    title: Clocking architecture',
    '    format: txt',
    '    path: architecture/clocking.txt',
    '    category: architectural',
    '',
  ].join('\n'));

  const client = new PythonAgentRuntimeClient({ mcpUrl: endpoint, requestTimeoutMs: 10_000 });
  const processed = await client.processSpecificationManifest();
  assert.equal(processed.ok, true);
  const trees = processed.trees as Array<Record<string, unknown>>;
  assert.equal(trees.length, 2);
  const selected = await client.selectTaskContext(
    trees,
    'rtl-development',
    'Implement accumulator ready clock logic',
    ['line:2'],
  );
  assert.equal(selected.ok, true);
  const selection = selected.selection as { selected_document_ids: string[] };
  assert.deepEqual(selection.selected_document_ids.sort(), ['REQ-ARCH-001', 'REQ-FUNC-001']);

  const functionalTree = trees.find((tree) => tree.document_id === 'REQ-FUNC-001') as {
    source_hash: string;
    nodes: Array<{ source: Record<string, unknown> }>;
  };
  const unified = {
    version: '1.0.0',
    documents: trees,
    requirements: [
      {
        id: 'REQ-ACC-001',
        category: 'functional',
        text: 'Accumulator must expose ready.',
        source_refs: [functionalTree.nodes[1].source],
        dependencies: [],
        acceptance_checks: ['rtl-interface-hash'],
      },
    ],
  };
  const gate = await client.validateGateOne(unified, ['functional', 'architectural']);
  assert.equal(gate.ok, true);
  const report = gate.gap_report as { gaps: unknown[] };
  assert.equal(report.gaps.length, 0);
  const locked = await client.softLockSpecification(
    unified,
    gate.dependency_graph as Record<string, unknown>,
    gate.gap_report as Record<string, unknown>,
    {
      version: '1.0.0',
      change_kind: 'major',
      rationale: ['Initial approved source set.'],
      unified_specification_hash: functionalTree.source_hash,
    },
    true,
  );
  assert.equal(locked.ok, true);
  const decision = locked.decision as { accepted: boolean; metadata: { soft_locked: boolean } };
  assert.equal(decision.accepted, true);
  assert.equal(decision.metadata.soft_locked, true);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ endpoint, trees: trees.length, selected: selection.selected_document_ids, gateGaps: report.gaps.length }));
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
