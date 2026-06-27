'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Edit3, Clock, Terminal, Brain } from 'lucide-react';
import type { ToolRequest } from '@agent_design/shared/types';
import { useAgentStore } from '../../lib/stores/agentStore';
import { useTelemetryStore } from '../../lib/stores/telemetryStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { clsx } from 'clsx';

interface ApprovalCardProps {
  request: ToolRequest;
}

export function ApprovalCard({ request }: ApprovalCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState(request.args.join(' '));
  const [isDone, setIsDone] = useState(false);

  const { agents } = useAgentStore();
  const { sessionId } = useTelemetryStore();
  const { approveTool, denyTool, modifyTool } = useWebSocket();

  const agent = agents.find((a) => a.id === request.agentId);

  const handleApprove = () => {
    if (!sessionId) return;
    if (isEditing) {
      modifyTool(request.id, request.command, editedArgs.split(/\s+/));
    } else {
      approveTool(request.id);
    }
    setIsDone(true);
  };

  const handleDeny = () => {
    if (!sessionId) return;
    denyTool(request.id);
    setIsDone(true);
  };

  if (isDone) return null;

  const estimatedMinutes = request.estimatedDurationSeconds
    ? Math.ceil(request.estimatedDurationSeconds / 60)
    : null;

  return (
    <div className="my-3 border border-accent/30 rounded-lg bg-accent/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-accent/10 border-b border-accent/20">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-accent" />
          <span className="text-sm font-mono text-accent">
            {agent?.name ?? 'Agent'}
          </span>
          <span className="text-xs text-gray-500">
            Attempt {request.attemptNumber}/{request.maxAttempts}
          </span>
        </div>
        {estimatedMinutes && (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Clock size={11} />
            ~{estimatedMinutes} min
          </div>
        )}
      </div>

      {/* Command */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-2 mb-2">
          <Terminal size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
          {isEditing ? (
            <div className="flex-1">
              <div className="text-xs text-gray-500 mb-1 font-mono">{request.command}</div>
              <textarea
                value={editedArgs}
                onChange={(e) => setEditedArgs(e.target.value)}
                className="w-full bg-surface text-white text-xs font-mono p-2 rounded border border-accent/40 focus:outline-none focus:border-accent resize-none"
                rows={3}
              />
            </div>
          ) : (
            <code className="text-xs font-mono text-green-400 break-all">
              {request.command} {request.args.join(' ')}
            </code>
          )}
        </div>

        <p className="text-xs text-gray-400 ml-5">
          <span className="text-gray-500">Reason:</span> {request.reason}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4 py-2.5 bg-surface-raised border-t border-surface-overlay">
        <button
          onClick={handleApprove}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-success/20 hover:bg-success/30 text-success border border-success/30 rounded text-xs font-medium transition-colors"
        >
          <CheckCircle size={13} />
          {isEditing ? 'Approve Modified' : 'Approve'}
        </button>

        <button
          onClick={handleDeny}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-error/10 hover:bg-error/20 text-error border border-error/30 rounded text-xs font-medium transition-colors"
        >
          <XCircle size={13} />
          Deny
        </button>

        <button
          onClick={() => setIsEditing(!isEditing)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 border rounded text-xs font-medium transition-colors',
            isEditing
              ? 'bg-warning/20 text-warning border-warning/30 hover:bg-warning/30'
              : 'bg-surface-overlay text-gray-400 border-surface-overlay hover:text-white',
          )}
        >
          <Edit3 size={13} />
          {isEditing ? 'Cancel Edit' : 'Edit Args'}
        </button>
      </div>
    </div>
  );
}