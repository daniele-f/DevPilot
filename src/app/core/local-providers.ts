import { AUTH } from "./auth";
import { REPOSITORY } from "./repository";
import { LocalApi, LocalAuth, LocalRepository } from "./local";
import { AI_CONNECTIONS } from "./connections";
import { LocalConnections } from "./local-connections";
import { CODEX_RUNS, LocalCodexRuns } from './codex-runs';
export function localProviders() {
  const api = new LocalApi();
  const auth = new LocalAuth(api);
  return [
    { provide: CODEX_RUNS, useValue: new LocalCodexRuns(api) },
    { provide: AI_CONNECTIONS, useValue: new LocalConnections(api) },
    { provide: AUTH, useValue: auth },
    {
      provide: REPOSITORY,
      useValue: new LocalRepository(api),
    },
  ];
}
