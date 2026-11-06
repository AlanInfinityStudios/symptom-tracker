// Builds the website into dist/. Settings come from environment variables when set,
// otherwise the project's own Supabase details (the publishable key is meant to be public).
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://nfndgpxjlsrvpyknytvx.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_tUk5uzY9JEWkwB5YfGRklA_kQ-iRoio";
const MOCK_URL = process.env.MOCK_URL || ""; // only used by the tests
const version = new Date().toISOString();

let html = readFileSync("src/index.html", "utf8");
for (const [k, v] of [["__SUPABASE_URL__", SUPABASE_URL], ["__SUPABASE_KEY__", SUPABASE_KEY], ["__MOCK_URL__", MOCK_URL]]) {
  if (!html.includes(k)) throw new Error(k + " not found in src/index.html");
  html = html.replace(k, v);
}
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
writeFileSync("dist/index.html", html);
writeFileSync("dist/sw.js", readFileSync("public/sw.js", "utf8").replace("__VERSION__", version));
console.log("Built dist/ " + version + (MOCK_URL ? " (test server " + MOCK_URL + ")" : ""));
