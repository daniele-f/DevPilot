import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app/app";
import { createProviders } from "./app/core/providers";

async function main(): Promise<void> {
  const providers = await createProviders();
  await bootstrapApplication(App, {
    providers: [provideZonelessChangeDetection(), ...providers],
  });
}
main().catch(() => {
  document.body.textContent =
    "DevPilot could not start. Check your connection and reload the page.";
});
