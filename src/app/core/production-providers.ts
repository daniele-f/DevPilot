import { createClient } from "@supabase/supabase-js";
import { AUTH, Auth } from "./auth";
import { REPOSITORY, SupabaseRepository } from "./repository";
export async function productionProviders() {
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load production configuration.");
  const config = (await response.json()) as {
    supabaseUrl: string;
    supabaseKey: string;
  };
  const client =
    config.supabaseUrl && config.supabaseKey
      ? createClient(config.supabaseUrl, config.supabaseKey)
      : null;
  return [
    { provide: AUTH, useValue: client ? new Auth(client) : null },
    {
      provide: REPOSITORY,
      useValue: client ? new SupabaseRepository(client) : null,
    },
  ];
}
