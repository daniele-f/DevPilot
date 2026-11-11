import { AUTH } from "./auth";
import { REPOSITORY } from "./repository";
import { LocalApi, LocalAuth, LocalRepository } from "./local";
export function localProviders() {
  const api = new LocalApi();
  const auth = new LocalAuth(api);
  return [
    { provide: AUTH, useValue: auth },
    {
      provide: REPOSITORY,
      useValue: new LocalRepository(api),
    },
  ];
}
