// Builds the website into dist/. Settings come from environment variables when set,
// otherwise the project's own Supabase details (the publishable key is meant to be public).
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://nfndgpxjlsrvpyknytvx.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_tUk5uzY9JEWkwB5YfGRklA_kQ-iRoio";
const MOCK_URL = process.env.MOCK_URL || ""; // only used by the tests
const DEMO = process.env.DEMO === "1"; // preview page with sample data, written to preview/
const version = new Date().toISOString();

let html = readFileSync("src/index.html", "utf8");
for (const [k, v] of [["__SUPABASE_URL__", SUPABASE_URL], ["__SUPABASE_KEY__", SUPABASE_KEY], ["__MOCK_URL__", MOCK_URL], ["__DEMO__", DEMO ? "1" : ""]]) {
  if (!html.includes(k)) throw new Error(k + " not found in src/index.html");
  html = html.replace(k, v);
}
if (DEMO) {
  // One self-contained page: libraries inlined, no service worker, no Supabase.
  const jspdf = readFileSync("public/vendor/jspdf-4.2.1.umd.min.js", "utf8").replace(/<\/script/gi, "<\\/script");
  let page = html.replace('<script src="/vendor/supabase-2.117.3.js"></script>\n', "")
    .replace('<script src="/vendor/jspdf-4.2.1.umd.min.js"></script>', () => "<script>" + jspdf + "</script>")
    .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, "").replace(/<\/head>\s*<body>/i, "").replace(/<\/body>\s*<\/html>\s*$/i, "")
    .replace(/<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\n/g, "")
    .replace("<title>Symptom Tracker</title>", "<title>Symptom Tracker Preview</title>");
  mkdirSync("preview", { recursive: true });
  writeFileSync("preview/index.html", page);
  console.log("Built preview/index.html " + version);
  process.exit(0);
}
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
writeFileSync("dist/index.html", html);
writeFileSync("dist/sw.js", readFileSync("public/sw.js", "utf8").replace("__VERSION__", version));
console.log("Built dist/ " + version + (MOCK_URL ? " (test server " + MOCK_URL + ")" : ""));
