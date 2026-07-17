'use client';

import { useEffect, useState } from 'react';
import { Activity, Cpu, Zap, Download, AlertCircle, Gauge, FlaskConical } from 'lucide-react';
import { useTelemetryStore } from '../../lib/stores/telemetryStore';
import { useAgentStore } from '../../lib/stores/agentStore';
import { telemetryApi, type ExperimentMetrics } from '../../lib/api/client';
import { clsx } from 'clsx';

const statusColors = {
  ok: 'text-success',
  running: 'text-warning animate-pulse',
  error: 'text-error',
  idle: 'text-gray-500',
};

const statusDots = {
  ok: 'bg-success',
  running: 'bg-warning animate-pulse',
  error: 'bg-error',
  idle: 'bg-gray-600',
};

export function TelemetryPanel() {
  const { metrics, edaStatus, tokensByAgent, currentGate, condition, sessionId, latestPPA } = useTelemetryStore();
  const { agents } = useAgentStore();
  const [experimentMetrics, setExperimentMetrics] = useState<ExperimentMetrics | null>(null);

  const activeAgents = agents.filter((a) => a.status === 'thinking' || a.status === 'awaiting-approval');

  // Fetch-on-demand (not live-streamed) — HCR/FPAR/PPA-drift are computed queries over the full
  // event log, re-fetched whenever the active session or its metrics change.
  useEffect(() => {
    if (!sessionId) {
      setExperimentMetrics(null);
      return;
    }
    telemetryApi.experimentMetrics(sessionId).then(setExperimentMetrics).catch(() => setExperimentMetrics(null));
  }, [sessionId, metrics]);

  const downloadTelemetry = () => {
    if (!sessionId || !condition) return;
    window.open(`/api/telemetry/logs/${condition}_${sessionId}.jsonl`, '_blank');
  };

  return (
    <div className="flex flex-col h-full bg-surface-raised border-l border-surface-overlay overflow-y-auto">
      <div className="px-4 py-3 border-b border-surface-overlay flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-mono text-gray-300">
          <Activity size={14} className="text-accent" />
          Telemetry
        </div>
        {sessionId && (
          <button
            onClick={downloadTelemetry}
            title="Download session JSONL"
            className="text-gray-500 hover:text-accent transition-colors"
          >
            <Download size={14} />
          </button>
        )}
      </div>

      {/* Token Tracker */}
      <Section title="Token Tracker" icon={<Zap size={12} />}>
        <div className="space-y-2">
          <TokenRow label="Input" value={metrics?.totalInputTokens ?? 0} color="text-blue-400" />
          <TokenRow label="Output" value={metrics?.totalOutputTokens ?? 0} color="text-purple-400" />
          <TokenRow label="Total" value={metrics?.totalTokens ?? 0} color="text-accent" bold />
        </div>
        {Object.entries(tokensByAgent).length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-gray-500 mb-1">Per Agent</p>
            {Object.entries(tokensByAgent).map(([agentId, tokens]) => {
              const agent = agents.find((a) => a.id === agentId);
              return (
                <div key={agentId} className="flex justify-between text-xs">
                  <span className="text-gray-400 truncate">{agent?.name ?? agentId.slice(0, 8)}</span>
                  <span className="text-gray-300 font-mono">{(tokens.input + tokens.output).toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Attempt Counter */}
      <Section title="Session Stats" icon={<Cpu size={12} />}>
        <div className="space-y-2">
          <StatRow label="Tool Executions" value={metrics?.toolExecutions ?? 0} />
          <StatRow label="Tool Failures" value={metrics?.toolFailures ?? 0} color="text-error" />
          <StatRow label="Human Approvals" value={metrics?.humanApprovals ?? 0} color="text-success" />
          <StatRow label="Human Denials" value={metrics?.humanDenials ?? 0} color="text-error" />
          <StatRow label="Human Edits" value={metrics?.humanModifications ?? 0} color="text-warning" />
          <StatRow label="Active Gate" value={currentGate} color="text-accent" />
          <StatRow label="Condition" value={condition ?? '—'} />
        </div>
      </Section>

      {/* EDA Tool Status */}
      <Section title="EDA Tool Status" icon={<Activity size={12} />}>
        <div className="space-y-2">
          {(['verilator', 'openroad', 'opensta'] as const).map((tool) => (
            <div key={tool} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={clsx('w-2 h-2 rounded-full', statusDots[edaStatus[tool]])} />
                <span className="text-xs text-gray-400 font-mono">{tool}</span>
              </div>
              <span className={clsx('text-xs font-mono', statusColors[edaStatus[tool]])}>
                {edaStatus[tool]}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* PPA Metrics */}
      {latestPPA && (
        <Section title="PPA Metrics" icon={<Gauge size={12} />}>
          <div className="space-y-2">
            <StatRow label="Area" value={`${latestPPA.area.toLocaleString()} µm²`} />
            <StatRow label="Power" value={`${latestPPA.power.toFixed(2)} mW`} />
            <StatRow label="Frequency" value={`${latestPPA.frequency.toFixed(1)} MHz`} />
            <StatRow label="WNS" value={`${latestPPA.wns} ns`} color={latestPPA.wns < 0 ? 'text-error' : 'text-success'} />
            <StatRow label="TNS" value={`${latestPPA.tns} ns`} color={latestPPA.tns < 0 ? 'text-error' : 'text-success'} />
            {latestPPA.cells !== undefined && <StatRow label="Cells" value={latestPPA.cells.toLocaleString()} />}
            {latestPPA.nets !== undefined && <StatRow label="Nets" value={latestPPA.nets.toLocaleString()} />}
          </div>
        </Section>
      )}

      {/* Experiment Metrics (thesis: HCR, FPAR, PPA drift) */}
      {experimentMetrics && (experimentMetrics.humanCorrectionRate !== null || experimentMetrics.firstPassAcceptanceRate !== null || experimentMetrics.ppaDrift.length > 0) && (
        <Section title="Experiment Metrics" icon={<FlaskConical size={12} />}>
          <div className="space-y-2">
            {experimentMetrics.humanCorrectionRate !== null && (
              <StatRow
                label="Human Correction Rate"
                value={`${(experimentMetrics.humanCorrectionRate * 100).toFixed(0)}%`}
                color={experimentMetrics.humanCorrectionRate > 0.3 ? 'text-error' : 'text-gray-300'}
              />
            )}
            {experimentMetrics.firstPassAcceptanceRate !== null && (
              <StatRow
                label="First-Pass Acceptance"
                value={`${(experimentMetrics.firstPassAcceptanceRate * 100).toFixed(0)}%`}
                color={experimentMetrics.firstPassAcceptanceRate < 0.5 ? 'text-warning' : 'text-success'}
              />
            )}
            {experimentMetrics.ppaDrift.length > 0 && (() => {
              const latest = experimentMetrics.ppaDrift[experimentMetrics.ppaDrift.length - 1];
              return (
                <>
                  <StatRow label="PPA Runs Compared" value={experimentMetrics.ppaDrift.length + 1} />
                  <StatRow
                    label="Latest Δ Area"
                    value={`${latest.deltaArea >= 0 ? '+' : ''}${latest.deltaArea.toLocaleString()} µm²`}
                    color={latest.deltaArea > 0 ? 'text-error' : 'text-success'}
                  />
                  <StatRow
                    label="Latest Δ WNS"
                    value={`${latest.deltaWns >= 0 ? '+' : ''}${latest.deltaWns} ns`}
                    color={latest.deltaWns < 0 ? 'text-error' : 'text-success'}
                  />
                </>
              );
            })()}
          </div>
        </Section>
      )}

      {/* Active Agents */}
      {activeAgents.length > 0 && (
        <Section title="Active Agents" icon={<AlertCircle size={12} className="text-warning" />}>
          <div className="space-y-2">
            {activeAgents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-warning animate-pulse" />
                <div>
                  <p className="text-xs text-gray-300">{agent.name}</p>
                  <p className="text-xs text-gray-500">{agent.status}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-surface-overlay">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-3 font-mono uppercase tracking-wider">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function TokenRow({ label, value, color, bold }: { label: string; value: number; color: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={clsx('text-xs font-mono', color, bold && 'font-bold')}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={clsx('text-xs font-mono', color ?? 'text-gray-300')}>{value}</span>
    </div>
  );
}