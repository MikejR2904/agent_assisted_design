# Implementation Workflow Reference

## Contents

1. [Preparation](#preparation)
2. [Contracts and tests](#contracts-and-tests)
3. [Python and TypeScript boundary](#python-and-typescript-boundary)
4. [Algorithm changes](#algorithm-changes)
5. [Documentation and validation](#documentation-and-validation)

## Preparation

Work from the repository root. Inspect the affected module, its direct tests, public exports, and any façade route before editing. Use the systems-design PDF and project proposals as requirements evidence, but label any new algorithm as a proposal until its behavior is encoded and tested. Keep a short implementation record under `docs/` that distinguishes implemented behavior, measured result, limitation, and planned follow-up.

## Contracts and tests

Add strict serializable contracts before behavior. Inputs from a model, HTTP request, MCP tool call, artifact, or subprocess are untrusted. Unknown public fields must stay rejected. Tool batches need acyclic dependencies. State transitions need evidence. Mutating and process tools require capability policy plus typed approval.

For each behavior, test normal success, malformed or unauthorized input, bounded failure, and deterministic persistence or audit state. For compaction algorithms, test dependency closure, protected over-budget behavior, manifest safety, deterministic tie-breaking, and a baseline comparison. Do not evaluate model quality through unrepeatable implicit model calls.

## Python and TypeScript boundary

Python remains the semantic owner of agent lifecycle, policy, state, provenance, telemetry, and compaction. TypeScript validates HTTP request shapes and forwards typed MCP operations. A new public Python capability requires: a Python unit test, MCP server exposure only when it is safe to expose remotely, a TypeScript client method, a route schema, focused TypeScript compilation, and a live cross-language integration test if the public route changes.

## Algorithm changes

Preserve a baseline. For PASK, benchmark `greedy-baseline` and `provenance-aware-submodular-knapsack` over identical episode graphs and budgets. Record runtime, before/after tokens, compacted IDs, mandatory evidence retention, provenance completeness, deadlock count, and downstream task outcome. Do not replace a deterministic selector with an embedding or RL scorer unless its assets, version, inputs, seed/ordering, and test corpus are reproducible.

## Documentation and validation

Place detailed developer material in `docs/`; keep `packages/agent-sdk/README.md` as durable navigation and architecture summary. Every claim should cite either an exact page/line in supplied material, current source/test behavior, or a primary public source. Run package tests and builds, validate examples, inspect generated files, check the skill, and run `git diff --check` before reporting completion.
