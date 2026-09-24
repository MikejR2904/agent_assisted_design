# Jev Advisory Evaluation Guide

**Status:** Implemented as an optional `typesafe-sdk` adapter in Agent SDK 0.14.0.
**Decision:** Jev is used only for redacted, typed, non-authoritative verification advice, safe-candidate exploration ranking, and a conservative single-to-multi-agent architecture lift.

## Position in the harness

Jev is not inserted into the model/tool loop as a replacement for `BaseAgent`. The system-design document defines a common BaseAgent contract with distinct tool, memory, termination, and verification elements, while deterministic modules retain separate authority.[1] The implementation therefore keeps Jev outside agent authority and exposes it as `ExternalDecisionProvider`-style evaluation beneath `agent_sdk.integrations`.

TypeSafe documents Jev/System One as a non-generative evaluator with typed `Noul`, `Choice`, and `Score` questions.[2] Its probabilities are informative but do not prove correctness for one output.[3] Accordingly, **no Jev answer may grant a capability, approve a tool, modify a graph, soft-lock a specification, or replace deterministic verification.**

| Permitted application | Required guard | Not permitted |
|---|---|---|
| Review whether a redacted evidence bundle appears complete after a local gate passes | `JevAdvisoryVerificationGate` with a deterministic local gate first | Treating a probability as proof of RTL, timing, PPA, or signoff correctness |
| Rank already-declared safe investigation candidates | `JevExplorationAdvisor` plus explicit unavailable behavior | Creating elastic work, changing an interface, or publishing graph state automatically |
| Lift a deterministic single-agent orchestration route when bounded planning metadata warrants additional review capacity | `JevArchitectureRouter`, a host policy, sanitized routing projection, and durable receipt | Lowering a deterministic multi-agent route, overriding `multi_agent_enabled`, selecting models, approving a plan, granting a capability, or dispatching workers |
| Request controller/human review for low confidence, unavailable provider, malformed response, or policy mismatch | `InteropFailureMode.ESCALATE` | Falling through to approval |

This boundary preserves the design’s deterministic verification and tool-hook authority split.[4]

## Question and state design

A question specification is host-owned, versioned, and immutable for an evaluation. Define it in source control or a reviewed configuration; do not let a model synthesize its question text or thresholds at runtime.

```python
from agent_sdk.integrations import JevNoulQuestion, JevQuestionSpec

review_v1 = JevQuestionSpec(
    spec_id="rtl-review-evidence",
    version="1.0.0",
    questions={
        "evidence_complete": JevNoulQuestion(
            instructions="The redacted record contains the declared review evidence.",
            criteria={
                True: "Every required evidence reference is present.",
                False: "At least one required evidence reference is absent.",
            },
        )
    },
)
```

The submitted `JevDecisionRequest.state` must be a small, redacted JSON projection. It is checked by `assert_sanitized_interop_value()` before provider dispatch. The projection must not include raw conversation, tool output, code, credentials, tokens, approval material, callbacks, or executable handles. Submit stable state facts and opaque evidence/artifact references instead of payloads.

## Provider construction and durable receipt

Install the optional extra and construct the evaluator only in the host process:

```bash
uv pip install "agent-design-agent-sdk[jev]"
```

```python
from agent_sdk.integrations import (
    TelemetryJevReceiptSink,
    TypeSafeJevDecisionEvaluator,
)

jev = TypeSafeJevDecisionEvaluator(
    receipt_sink=TelemetryJevReceiptSink(telemetry, lambda receipt: telemetry_context),
    policy_version="rtl-review-policy-v1",
)
```

An explicit receipt sink is required. This makes omission of the interoperability audit path a construction error rather than a silent logging gap. The telemetry sink records only a typed receipt: operation, status, run ID, state and result digests, question-spec digest, model/request identifier if supplied, duration, retry count, declared policy outcome, and available provider token counters. It does **not** store input state, question content, response text, or hidden reasoning.

## Advisory gate composition

```python
from agent_sdk import VerificationGateRegistry
from agent_sdk.integrations import JevAdvisoryPolicy, JevAdvisoryVerificationGate

local_gates = VerificationGateRegistry()
local_gate = local_gates.resolve("status-is-complete")
assert local_gate is not None

advisory_gate = JevAdvisoryVerificationGate(
    local_gate,
    jev,
    request_factory=make_redacted_review_request,
    policy=JevAdvisoryPolicy(
        question_id="evidence_complete",
        minimum_noul=0.90,
        on_unavailable="escalate",
        on_below_threshold="escalate",
    ),
)
```

The local gate runs before the remote evaluator. If it rejects, the advisory evaluator is not invoked. If it passes, a high-enough `Noul` produces a positive gate decision with a receipt-backed reason; lower confidence, an unknown question result, an unavailable provider, or a malformed result follows the declared reject/escalate behavior. A host registers this gate under a static identifier in `VerificationGateRegistry`; it does not expose a callback through model output or MCP.

## Exploration ranking

`JevExplorationAdvisor` takes `ExplorationCandidate` records that were already discovered and made eligible by SDK graph/controller logic. Each candidate carries a stable ID, bounded summary, deterministic fallback rank, and provenance reference. The advisor asks a `Choice` question over exactly those IDs. A response outside that finite set is invalid and causes the configured unavailable behavior.

Choose `fallback-deterministic` only when the deterministic rank is an acceptable continuation. Use `escalate` when a human/controller must decide whether an unavailable evaluator is material. Neither setting gives Jev permission to add a graph edge, request a tool, or author a task.

## Orchestration architecture advice

`JevArchitectureRouter` is called only after `ComplexityRouter` has calculated the deterministic result. The router receives a small request-specific projection containing the stage, gap categories/types and blast radius, plan task/dependency count, model tiers, and declared elastic limits. It may only recommend a conservative `single-agent` to `multi-agent` lift. The SDK rejects any attempted downgrade of a deterministic multi-agent route and rejects a lift when the user policy disables multi-agent execution.[5] [6]

The controller applies a recorded lift only while it is still in its planning phase. It then continues through the same deterministic plan validation and explicit human approval path. Jev does not receive source text, worker transcript, tool payload, credentials, capability grant, approval material, callback, or executable handle. The host must persist the normal Jev receipt; the remote MCP lifecycle does not accept advisory responses or evaluator credentials. See the [governed orchestration guide](orchestration-guide.md) for the host-binding and MCP boundary.[5] [6]

## Operational constraints

The concrete adapter calls TypeSafe’s asynchronous `system_one(...)` API only after the host selects a model ID and builds a bounded request.[2] It enforces a 20-second default deadline, one default attempt, and hard maximums of 300 seconds and three attempts. Provider exceptions normalize to an unavailable result with a stable error category rather than exposing the raw provider error or treating failure as acceptance.

Before deployment, create negative tests for provider outage, invalid answer type, wrong answer IDs, missing/extra choice probability keys, sub-threshold probability, a deterministic local-gate rejection, forbidden redaction content, and missing receipt persistence. Review every question specification and threshold as part of the same change that updates the deterministic acceptance contract.

## References

[1]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 50, lines 4–14](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[2]: [TypeSafe System One API](https://docs.typesafe.ai/api)

[3]: [TypeSafe System One concepts](https://docs.typesafe.ai/concepts/system-one)

[4]: [Agent-Assisted Design Framework Systems Design, updated PDF, p. 55, lines 2–14](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[5]: [Agent-Assisted Design Framework Systems Design, updated PDF, pp. 41–42, lines 2–12 and 2–13](/home/ubuntu/upload/Agent-AssistedDesignFrameworkSystemsDesign-updated.pdf)

[6]: [Agent SDK orchestration implementation](../packages/agent-sdk/src/agent_sdk/orchestrator.py)
