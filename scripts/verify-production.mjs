import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const output = "dist/devpilot/browser";
const files = await readdir(output, { recursive: true });
for (const file of files.filter((file) => file.endsWith(".js"))) {
  const source = await readFile(join(output, file), "utf8");
  if (
    source.includes("devpilot.local.") ||
    source.includes("local-dev") ||
    source.toLowerCase().includes("x-devpilot-local")
  ) {
    throw new Error(
      `Development-only account or persistence code found in production: ${file}`,
    );
  }
}
const config = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
if (
  typeof config.supabaseUrl !== "string" ||
  typeof config.supabaseKey !== "string"
)
  throw new Error("Production Supabase configuration was not generated.");
console.log(
  "Production separation verified: no local development account or storage adapter shipped.",
);
