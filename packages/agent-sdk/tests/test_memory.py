from __future__ import annotations

from agent_sdk.memory import CompactionStatus, InMemoryEpisodeStore


def test_episode_store_enforces_closed_exploratory_dependencies_and_manifest_compaction():
    store = InMemoryEpisodeStore()
    exploration = store.open_exploratory(
        "worker-a",
        substrate_backed=True,
        snapshot_version="spec-v1",
        content={"raw": "locked signal declaration"},
    )
    store.close(exploration.id, description="Read the locked signal declaration.")
    action = store.open_action(
        "worker-a",
        [exploration.id],
        content={"log": "x" * 100},
        requires_manifest=True,
    )
    store.close(action.id)

    blocked = store.compact(20)
    assert blocked.status is CompactionStatus.CONTEXT_DEADLOCK
    assert action.id in blocked.blocked_episode_ids

    store.attach_eda_manifest(
        action.id, {"inputs": ["rtl/top.sv"], "outputs": ["reports/lint.log"]}
    )
    compacted = store.compact(20)

    assert compacted.status is CompactionStatus.COMPACTED
    assert action.id in compacted.compacted_episode_ids
    assert store.get(action.id).content is None


def test_episode_checkpoint_hash_changes_when_structural_state_changes():
    store = InMemoryEpisodeStore()
    episode = store.open_exploratory("worker-a", content={"raw": "spec"})
    store.close(episode.id, description="Read specification.")
    checkpoint = store.checkpoint()

    assert store.verify_checkpoint(checkpoint) is True

    another = store.open_exploratory("worker-a", content={"raw": "another"})
    store.close(another.id, description="Read another fact.")
    assert store.verify_checkpoint(checkpoint) is False
