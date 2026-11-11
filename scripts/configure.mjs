import { mkdir, writeFile } from "node:fs/promises";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
if (
  supabaseKey.startsWith("sb_secret_") ||
  (supabaseKey.split(".")[1] &&
    JSON.parse(Buffer.from(supabaseKey.split(".")[1], "base64url").toString())
      .role === "service_role")
) {
  throw new Error(
    "Only a Supabase publishable or anon key may be included in the browser.",
  );
}
await mkdir(".generated/production", { recursive: true });
await writeFile(
  ".generated/production/config.json",
  JSON.stringify({ supabaseUrl, supabaseKey }),
);
if (!supabaseUrl || !supabaseKey)
  console.warn(
    "Supabase is not configured. The app will show setup instructions.",
  );
