from __future__ import annotations

from agent_sdk.memory import (
    CompactionStatus,
    CompactionStrategy,
    InMemoryEpisodeStore,
    PaskCompactionPolicy,
)


def _closed_exploration(store: InMemoryEpisodeStore, content: dict[str, str]):
    episode = store.open_exploratory("worker", content=content)
    return store.close(episode.id, description="Exploratory specification evidence.")


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
