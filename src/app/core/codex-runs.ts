import { InjectionToken } from '@angular/core';
import { LocalApi, LocalApiError } from './local';
import { Item, Project } from './models';

export interface CodexQuestion {
  id: string;
  header: string;
  question: string;
  options?: { label: string; description: string }[] | null;
}
export interface CodexRequest {
  id: string | number;
  kind: 'approval' | 'question';
  method: string;
  params: {
    reason?: string;
    command?: string;
    cwd?: string;
    grantRoot?: string;
    networkApprovalContext?: { host: string; protocol: string };
    questions?: CodexQuestion[];
  };
  item?: { changes?: { path: string; diff: string }[] };
}
export interface CodexRun {
  id: string;
  status: 'starting' | 'running' | 'waiting' | 'review' | 'needs_input' | 'failed' | 'interrupted';
  cwd: string;
  thread_id: string | null;
  summary: string;
  pending: CodexRequest[];
}
export interface CodexClient {
  overview?(): Promise<CodexOverview[]>;
  config(projectId: string): Promise<{ cwd: string }>;
  configure(projectId: string, cwd: string): Promise<{ cwd: string }>;
  state(itemId: string): Promise<CodexRun | null>;
  start(itemId: string, message?: string): Promise<CodexRun>;
  reply(itemId: string, value: { request_id: string | number; decision?: 'accept' | 'decline'; answers?: Record<string, string> }): Promise<CodexRun>;
  stop(itemId: string): Promise<CodexRun>;
}
export const CODEX_RUNS = new InjectionToken<CodexClient>('Local Codex runs');
export class LocalCodexRuns implements CodexClient {
  constructor(private readonly api: LocalApi) {}
  async overview(): Promise<CodexOverview[]> {
    try { return await this.api.call('/codex/runs'); }
    catch (error) {
      // The launcher deliberately keeps the API alive through backend edits.
      // Older running APIs still expose authoritative per-story run state.
      if (!(error instanceof LocalApiError) || error.status !== 404) throw error;
      const projects = await this.api.call<Project[]>('/projects');
      const result: CodexOverview[] = [];
      for (const project of projects) {
        const items = await this.api.call<Item[]>(`/projects/${encodeURIComponent(project.id)}/items`);
        const candidates = items.filter(item => !item.archived_at && item.status !== 'done');
        for (let offset = 0; offset < candidates.length; offset += 6) {
          const batch = await Promise.all(candidates.slice(offset, offset + 6).map(async item => {
            try {
              const run = await this.state(item.id);
              return run && ['starting', 'running', 'waiting', 'needs_input'].includes(run.status)
                ? { item, status: run.status, approval: run.pending.some(request => request.kind === 'approval') } : null;
            } catch (error) {
              if (error instanceof LocalApiError && error.status === 404) return null;
              throw error;
            }
          }));
          for (const entry of batch) if (entry) result.push(entry);
        }
      }
      return result;
    }
  }
  config(projectId: string): Promise<{ cwd: string }> { return this.api.call(`/projects/${encodeURIComponent(projectId)}/codex`); }
  configure(projectId: string, cwd: string): Promise<{ cwd: string }> { return this.api.call(`/projects/${encodeURIComponent(projectId)}/codex`, 'PUT', { cwd }); }
  state(itemId: string): Promise<CodexRun | null> { return this.api.call(`/items/${encodeURIComponent(itemId)}/codex`); }
  start(itemId: string, message?: string): Promise<CodexRun> { return this.api.call(`/items/${encodeURIComponent(itemId)}/codex`, 'POST', { ...(message?.trim() ? { message: message.trim() } : {}) }); }
  reply(itemId: string, value: { request_id: string | number; decision?: 'accept' | 'decline'; answers?: Record<string, string> }): Promise<CodexRun> { return this.api.call(`/items/${encodeURIComponent(itemId)}/codex/reply`, 'POST', value); }
  stop(itemId: string): Promise<CodexRun> { return this.api.call(`/items/${encodeURIComponent(itemId)}/codex/stop`, 'POST', {}); }
}
export interface CodexOverview {
  item: import('./models').Item;
  status: CodexRun['status'];
  approval: boolean;
}
