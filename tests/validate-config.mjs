import { readFileSync } from "node:fs";

const toml = readFileSync("wrangler.toml", "utf8");
const entry = readFileSync("src/entry.js", "utf8");
const daily = readFileSync("src/daily.js", "utf8");
const tables = readFileSync("src/tables.js", "utf8");
const workflow = readFileSync("src/workflow.js", "utf8");
const publish = readFileSync("src/publish.js", "utf8");

const checks = [
  [toml.includes('name = "blue-cloud-c7c2"'), "wrangler name matches dashboard worker"],
  [toml.includes('main = "src/entry.js"'), "wrangler main is src/entry.js"],
  [toml.includes('binding = "AI"'), "AI binding present"],
  [toml.includes('binding = "DAILY_DISCOVERY"'), "workflow binding present"],
  [toml.includes('class_name = "GlobalDiscoveryWorkflow"'), "workflow class present"],
  [toml.includes('binding = "DB"'), "D1 binding present"],
  [entry.includes("export { GlobalDiscoveryWorkflow }"), "entry exports workflow class"],
  [entry.includes("ensureExtendedTables"), "entry initializes schema"],
  [entry.includes("/status"), "status route exists"],
  [entry.includes("podcastResponse"), "podcast route wired"],
  [daily.includes("ensureExtendedTables"), "daily re-exports schema helper"],
  [tables.includes("export async function ensureExtendedTables"), "tables exports ensureExtendedTables"],
  [workflow.includes("export class GlobalDiscoveryWorkflow"), "workflow class exported"],
  [workflow.includes("sameInstance"), "workflow can resume its own run"],
  [publish.includes("export async function podcastResponse"), "podcast helper exported"],
  [!daily.includes('.replace(/"/g, """)'), "daily.js has no broken quote literal"]
];

const failed = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) {
  console.log((ok ? "OK  " : "FAIL") + " " + label);
}
if (failed.length) {
  process.exit(1);
}
