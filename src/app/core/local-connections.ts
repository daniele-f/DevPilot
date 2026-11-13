import {
  AiConnection,
  ConnectionsClient,
  CreatedConnection,
} from "./connections";
import { LocalApi } from "./local";
export class LocalConnections implements ConnectionsClient {
  constructor(private readonly api: LocalApi) {}
  async serverUrl(): Promise<string> {
    const value = await this.api.call<{ url: string }>("/connections/server");
    return value.url;
  }
  list(projectId: string): Promise<AiConnection[]> {
    return this.api.call(
      `/projects/${encodeURIComponent(projectId)}/connections`,
    );
  }
  create(
    projectId: string,
    name: string,
    permission: "read" | "edit",
  ): Promise<CreatedConnection> {
    return this.api.call(
      `/projects/${encodeURIComponent(projectId)}/connections`,
      "POST",
      { name, permission },
    );
  }
  revoke(projectId: string, id: string): Promise<void> {
    return this.api.call(
      `/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
}
