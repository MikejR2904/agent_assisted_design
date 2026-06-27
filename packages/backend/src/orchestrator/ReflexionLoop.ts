import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface TaskState {
  agentId: string;
  taskId: string;
  attempts: number;
  maxAttempts: number;
  errorHistory: string[];
  startedAt: Date;
}

export type ReflexionResult =
  | { status: 'success'; output: string }
  | { status: 'failed'; reason: string; attempts: number; errors: string[] }
  | { status: 'max_attempts_exceeded'; errors: string[] };

export class ReflexionLoop {
  private tasks = new Map<string, TaskState>();

  createTask(agentId: string, maxAttempts = 3): TaskState {
    const state: TaskState = {
      agentId,
      taskId: uuidv4(),
      attempts: 0,
      maxAttempts,
      errorHistory: [],
      startedAt: new Date(),
    };
    this.tasks.set(state.taskId, state);
    return state;
  }

  recordAttempt(taskId: string): TaskState {
    const state = this.getTask(taskId);
    state.attempts++;
    logger.info('Reflexion attempt', {
      taskId,
      agentId: state.agentId,
      attempt: state.attempts,
      maxAttempts: state.maxAttempts,
    });
    return state;
  }

  recordError(taskId: string, error: string): void {
    const state = this.getTask(taskId);
    state.errorHistory.push(error);
  }

  shouldRetry(taskId: string): boolean {
    const state = this.getTask(taskId);
    return state.attempts < state.maxAttempts;
  }

  isExhausted(taskId: string): boolean {
    const state = this.getTask(taskId);
    return state.attempts >= state.maxAttempts;
  }

  buildErrorFeedback(taskId: string): string {
    const state = this.getTask(taskId);
    const lastError = state.errorHistory[state.errorHistory.length - 1];
    return [
      `Attempt ${state.attempts}/${state.maxAttempts} failed.`,
      `Error: ${lastError}`,
      `Please analyze the error carefully and try a different approach.`,
      `Previous errors: ${state.errorHistory.slice(0, -1).join(' | ')}`,
    ].join('\n');
  }

  getTask(taskId: string): TaskState {
    const state = this.tasks.get(taskId);
    if (!state) throw new Error(`Unknown task: ${taskId}`);
    return state;
  }

  cleanup(taskId: string): void {
    this.tasks.delete(taskId);
  }
}