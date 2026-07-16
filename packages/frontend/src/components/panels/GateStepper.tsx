'use client';

import { GATE_DEFINITIONS } from '@agent_design/shared/constants';
import type { Gate } from '@agent_design/shared/types';
import { CheckCircle, Circle, ShieldCheck } from 'lucide-react';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { clsx } from 'clsx';

export function GateStepper() {
  const { getActiveSession } = useSessionStore();
  const { advanceGate, approveGate } = useWebSocket();

  const session = getActiveSession();
  const currentGate = session?.currentGate ?? 'G1';
  const completedGates = session?.gatesCompleted ?? [];
  const gateOrder = ['G1', 'G2', 'G3', 'G4'] as Gate[];
  const currentIdx = gateOrder.indexOf(currentGate);
  const isCurrentGateApproved = session?.gateApprovals?.[currentGate]?.approved ?? false;

  const handleSetGate = (gate: Gate) => {
    if (!session) return;
    advanceGate(gate);
  };

  const handleApprove = (gate: Gate) => {
    if (!session) return;
    approveGate(gate);
  };

  return (
    <div className="flex items-center gap-0 px-4 py-3 bg-surface-raised border-b border-surface-overlay">
      {GATE_DEFINITIONS.map((gate, idx) => {
        const isCompleted = completedGates.includes(gate.id as Gate);
        const isActive = gate.id === currentGate;
        const isPending = idx > currentIdx && !isCompleted;
        const isApproved = session?.gateApprovals?.[gate.id as Gate]?.approved ?? false;

        return (
          <div key={gate.id} className="flex items-center flex-1">
            <button
              onClick={() => handleSetGate(gate.id as Gate)}
              title={`${gate.label}\n${gate.description}${isApproved ? '\n\n✓ Approved' : ''}`}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono transition-all',
                isActive && 'bg-accent/20 text-accent border border-accent',
                isCompleted && !isActive && 'text-success cursor-default',
                isPending && 'text-gray-500 cursor-not-allowed opacity-50',
                !isActive && !isCompleted && !isPending && 'hover:text-white text-gray-400',
              )}
              disabled={isPending}
            >
              {isCompleted ? (
                <CheckCircle size={14} className="text-success" />
              ) : isActive ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-accent bg-accent/30 animate-pulse" />
              ) : (
                <Circle size={14} />
              )}
              <span>{gate.id}</span>
              <span className="hidden lg:inline text-gray-400">— {gate.label}</span>
              {isApproved && (
                <ShieldCheck size={12} className="text-success" />
              )}
            </button>

            {isActive && !isCurrentGateApproved && (
              <button
                onClick={() => handleApprove(gate.id as Gate)}
                title={`Approve ${gate.id} — required before physical EDA tools (OpenROAD/OpenSTA) can run at G3`}
                className="ml-1.5 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border border-success/30 bg-success/10 text-success hover:bg-success/20 transition-colors"
              >
                <ShieldCheck size={11} />
                Approve
              </button>
            )}

            {idx < GATE_DEFINITIONS.length - 1 && (
              <div className={clsx(
                'h-px flex-1 mx-2',
                idx < currentIdx ? 'bg-success/50' : 'bg-surface-overlay',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
