// Refuses a results file that lacks what a published figure must carry.
//   node tools/check-results.mjs FILE [--publishable]
// With --publishable it also requires at least 7 runs, a full run, a clean RTE commit, and a quiet machine (load below 1.0 before the run).
import { readFileSync } from "node:fs";

const need = [
  "schema", "date", "mode", "argv", "node", "driver.playwright", "driver.chromium", "sandbox",
  "rte.commit", "rte.coreSha256", "rte.viewSha256", "bench.commit", "bench.imageId",
  "machine.cpu", "machine.logicalCpus", "machine.kernel", "load.before", "load.after", "runs", "results.cold", "results.mem",
];
const get = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);

export function problems(result, { publishable = false } = {}) {
  const out = need.filter((p) => get(result, p) === undefined || get(result, p) === null).map((p) => `missing ${p}`);
  if (result.schema !== undefined && result.schema !== 2) out.push(`schema is ${result.schema}, not 2`);
  if (publishable) {
    if (result.runs < 7) out.push(`only ${result.runs} runs (needs 7 or more)`);
    if (result.mode !== "full") out.push(`a ${result.mode} run is not publishable`);
    if (!(get(result, "load.before.0") < 1)) out.push(`the machine was not idle (load ${get(result, "load.before.0")})`);
    if (!/^[0-9a-f]{40}$/.test(get(result, "bench.commit") ?? "")) out.push("bench.commit is not a full commit");
    if (!/^[0-9a-f]{40}$/.test(get(result, "rte.commit") ?? "")) out.push("rte.commit is not a full commit");
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error("usage: check-results.mjs FILE [--publishable]"); process.exit(2); }
  const found = problems(JSON.parse(readFileSync(file, "utf8")), { publishable: process.argv.includes("--publishable") });
  if (found.length) { console.error(`${file}:\n  ${found.join("\n  ")}`); process.exit(1); }
  console.log(`${file}: ok`);
}
