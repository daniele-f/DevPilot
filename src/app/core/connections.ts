import { InjectionToken } from "@angular/core";
export interface AiConnection {
  id: string;
  project_id: string;
  name: string;
  permission: "read" | "edit";
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
export interface CreatedConnection extends AiConnection {
  configuration: string;
}
export interface ConnectionsClient {
  serverUrl(): Promise<string>;
  list(projectId: string): Promise<AiConnection[]>;
  create(
    projectId: string,
    name: string,
    permission: "read" | "edit",
  ): Promise<CreatedConnection>;
  revoke(projectId: string, id: string): Promise<void>;
}
export const AI_CONNECTIONS = new InjectionToken<ConnectionsClient>(
  "Project AI connections",
);
