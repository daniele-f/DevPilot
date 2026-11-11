import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { createClient } from "@supabase/supabase-js";
import { App } from "./app/app";
import { AUTH, Auth } from "./app/core/auth";
import { REPOSITORY, SupabaseRepository } from "./app/core/repository";

async function main(): Promise<void> {
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok)
    throw new Error("Unable to load application configuration.");
  const config = (await response.json()) as {
    supabaseUrl: string;
    supabaseKey: string;
  };
  const client =
    config.supabaseUrl && config.supabaseKey
      ? createClient(config.supabaseUrl, config.supabaseKey)
      : null;
  await bootstrapApplication(App, {
    providers: [
      provideZonelessChangeDetection(),
      { provide: AUTH, useValue: client ? new Auth(client) : null },
      {
        provide: REPOSITORY,
        useValue: client ? new SupabaseRepository(client) : null,
      },
    ],
  });
}
main().catch(() => {
  document.body.textContent =
    "DevPilot could not start. Check your connection and reload the page.";
});
