from __future__ import annotations

from agent_sdk.memory import (
    CompactionStatus,
    CompactionStrategy,
    InMemoryEpisodeStore,
    LexicalEpisodeRelevanceScorer,
    PaskCompactionPolicy,
)
from agent_sdk.optimization import PckpStatus


def _closed_exploration(store: InMemoryEpisodeStore, content: dict[str, str]):
    episode = store.open_exploratory("worker", content=content)
    return store.close(episode.id, description="Exploratory specification evidence.")


def test_lexical_relevance_scorer_uses_unique_query_term_coverage():
    store = InMemoryEpisodeStore()
    episode = _closed_exploration(
        store,
        {"text": "reset synchronizer protects metastability in the destination domain"},
    )

    score = LexicalEpisodeRelevanceScorer().score("reset reset synchronizer protocol", episode)

    assert score == 2 / 3


def test_pask_retains_relevant_action_and_its_dependency_closure():
    store = InMemoryEpisodeStore(
        compaction_policy=PaskCompactionPolicy(strategy=CompactionStrategy.PASK)
    )
    specification = _closed_exploration(
        store,
        {"text": "reset domain synchronous active low reset protocol " * 4},
    )
    action = store.open_action(
        "worker",
        [specification.id],
        content={"text": "implemented reset protocol assertion and lint evidence " * 4},
    )
    store.close(action.id)
    noise = _closed_exploration(store, {"text": "unrelated cache replacement policy " * 40})

    result = store.compact(
        200,
        relevance_query="verify reset protocol assertion",
    )

    assert result.status is CompactionStatus.COMPACTED
    assert action.id not in result.compacted_episode_ids
    assert specification.id not in result.compacted_episode_ids
    assert noise.id in result.compacted_episode_ids
    assert result.strategy is CompactionStrategy.PASK
    assert result.dossier["guarantee"].startswith("dependency closure")
    assert "relevance_query" not in result.dossier
    assert result.dossier["relevance_query_hash"]


def test_pask_explicitly_reports_unfit_mandatory_dependency_closure():
    store = InMemoryEpisodeStore(
        compaction_policy=PaskCompactionPolicy(strategy=CompactionStrategy.PASK)
    )
    protected = _closed_exploration(store, {"text": "must preserve " * 100})

    result = store.compact(
        8,
        protected_episode_ids=[protected.id],
        relevance_query="must preserve",
    )

    assert result.status is CompactionStatus.PROTECTED_OVER_BUDGET
    assert protected.id in result.blocked_episode_ids
    assert result.compacted_episode_ids == []
    assert result.dossier["mandatory_tokens"] > result.dossier["token_budget"]


def test_pask_can_be_compared_with_original_greedy_baseline():
    def make_store(strategy: CompactionStrategy) -> tuple[InMemoryEpisodeStore, str]:
        store = InMemoryEpisodeStore(compaction_policy=PaskCompactionPolicy(strategy=strategy))
        specification = _closed_exploration(
            store,
            {"text": "reset protocol signal declaration " * 5},
        )
        action = store.open_action(
            "worker",
            [specification.id],
            content={"text": "reset protocol implemented lint passed " * 5},
        )
        store.close(action.id)
        _closed_exploration(store, {"text": "unrelated documentation " * 70})
        return store, action.id

    pask_store, pask_action = make_store(CompactionStrategy.PASK)
    baseline_store, baseline_action = make_store(CompactionStrategy.GREEDY_BASELINE)

    pask = pask_store.compact(200, relevance_query="reset protocol lint")
    baseline = baseline_store.compact(200, relevance_query="reset protocol lint")

    assert pask_action not in pask.compacted_episode_ids
    assert baseline_action in baseline.compacted_episode_ids
    assert pask.strategy is CompactionStrategy.PASK
    assert baseline.strategy is CompactionStrategy.GREEDY_BASELINE


def test_pask_access_frequency_is_harness_owned_and_changes_score_not_safety():
    store = InMemoryEpisodeStore(
        compaction_policy=PaskCompactionPolicy(strategy=CompactionStrategy.PASK)
    )
    frequently_used = _closed_exploration(store, {"text": "clock crossing handshake " * 4})
    noise = _closed_exploration(store, {"text": "generic note " * 50})
    store.mark_accessed([frequently_used.id])
    store.mark_accessed([frequently_used.id])

    result = store.compact(80, relevance_query="clock crossing handshake")

    utilities = result.dossier["selected_utilities"]
    selected = next(item for item in utilities if item["episode_id"] == frequently_used.id)
    assert selected["frequency"] == 1.0
    assert noise.id in result.compacted_episode_ids


def test_exact_pckp_compaction_records_a_bounded_anytime_certificate():
    store = InMemoryEpisodeStore(compaction_policy=PaskCompactionPolicy(exact_max_branch_nodes=1))
    left = _closed_exploration(store, {"text": "left dependency evidence " * 20})
    right = _closed_exploration(store, {"text": "right dependency evidence " * 20})
    joint = store.open_action(
        "worker",
        [left.id, right.id],
        content={"text": "joint verification depends on both sources " * 20},
    )
    store.close(joint.id)

    result = store.compact(50, relevance_query="joint verification")

    solver = result.dossier["solver"]
    assert result.strategy is CompactionStrategy.EXACT_PCKP
    assert result.dossier["branch_node_limit"] == 1
    assert solver["status"] == PckpStatus.BEST_EFFORT.value
    assert solver["branch_nodes"] == 1
    assert result.dossier["guarantee"] == "feasible best-effort selection with explicit bound"
