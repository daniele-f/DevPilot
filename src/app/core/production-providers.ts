import { createClient } from "@supabase/supabase-js";
import { AUTH, Auth } from "./auth";
import { createAuthStorage } from "./auth-storage";
import { REPOSITORY, SupabaseRepository } from "./repository";
export async function productionProviders() {
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load production configuration.");
  const config = (await response.json()) as {
    supabaseUrl: string;
    supabaseKey: string;
  };
  const storage = config.supabaseUrl && config.supabaseKey ? createAuthStorage() : undefined;
  const client =
    storage
      ? createClient(config.supabaseUrl, config.supabaseKey, {
          auth: { storage, persistSession: true },
        })
      : null;
  return [
    { provide: AUTH, useValue: client ? new Auth(client, storage) : null },
    {
      provide: REPOSITORY,
      useValue: client ? new SupabaseRepository(client) : null,
    },
  ];
}
