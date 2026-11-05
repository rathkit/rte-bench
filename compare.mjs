// Compares two benchmark results: the same harness on the base commit and on the change, run on the same machine one after the other.
// A fixed budget cannot see a change that makes a command twice as slow while it stays inside its budget; this does, because both runs share the machine.
//   node compare.mjs base-1.json,base-2.json head-1.json,head-2.json [--accepted accepted.json]
// Several runs per side are folded to the best (lowest) figure, so one noisy run does not fail a change. A figure fails when it is
// both slower by the ratio and by more than the floor (so a 0.9 ms figure that becomes 1.4 ms is noise, not a regression).
// An increase that was approved is recorded in the product repository's accepted.json (mounted at /limits), with its reason, in the same commit as the code that causes it.
import { readFileSync } from "node:fs";

/** Per-kind rules: how much worse may it get. Times are medians in milliseconds; sizes are in bytes. */
export const rules = {
  time: { ratio: 1.5, floor: 2 },
  bytes: { ratio: 1.1, floor: 300_000 },
};

/** Flattens a result into { "p1000.typeMiddle": { kind, value } }, taking the median of every timing and every byte count. */
export function figures(results) {
  const out = {};
  const walk = (prefix, node) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && typeof v.median === "number") out[path] = { kind: "time", value: v.median };
      else if (typeof v === "number" && /Bytes$/.test(k) && prefix === "mem") out[path] = { kind: "bytes", value: v };
      else if (typeof v === "number" && k === "javascriptBytes") out[path] = { kind: "bytes", value: v };
      else if (v && typeof v === "object") walk(path, v);
    }
  };
  walk("", results);
  return out;
}

const best = (runs) => {
  const out = {};
  for (const run of runs) for (const [path, f] of Object.entries(figures(run))) if (!(path in out) || f.value < out[path].value) out[path] = f;
  return out;
};

/** @returns sentences, one for each figure that got worse than allowed (empty when none did). `accepted` maps a figure to { ratio, reason }. */
export function regressions(baseRuns, headRuns, accepted = {}) {
  const base = best(baseRuns);
  const head = best(headRuns);
  const out = [];
  for (const [path, was] of Object.entries(base)) {
    const now = head[path];
    if (!now) continue;
    const rule = rules[was.kind];
    const ratio = accepted[path]?.ratio ?? rule.ratio;
    if (now.value > was.value * ratio && now.value - was.value > rule.floor) {
      const unit = was.kind === "time" ? "ms" : "bytes";
      const f = (x) => (was.kind === "time" ? x.toFixed(1) : String(Math.round(x)));
      out.push(`${path}: ${f(was.value)} ${unit} became ${f(now.value)} ${unit} (${(now.value / was.value).toFixed(2)}x; allowed ${ratio}x and more than ${rule.floor} ${unit} in all)${accepted[path] ? ` [approved ratio, see accepted.json]` : ""}`);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const load = (list) => list.split(",").map((f) => JSON.parse(readFileSync(f, "utf8")).results);
  const rest = process.argv.slice(2);
  const at = rest.indexOf("--accepted");
  const acceptedFile = at >= 0 ? rest.splice(at, 2)[1] : undefined;
  const [base, head] = rest;
  if (!base || !head) { console.error("usage: compare.mjs base-1.json[,base-2.json] head-1.json[,head-2.json]"); process.exit(2); }
  const accepted = acceptedFile ? JSON.parse(readFileSync(acceptedFile, "utf8")).accepted : {};
  const baseRuns = load(base);
  const headRuns = load(head);
  const found = regressions(baseRuns, headRuns, accepted);
  console.log(`compared ${Object.keys(figures(baseRuns[0])).length} figures, best of ${baseRuns.length} run(s) on each side`);
  if (found.length) { console.log(`SLOWER THAN THE BASE\n  ${found.join("\n  ")}\nIf the cost is approved, add the figure to tools/bench/accepted.json in the product repository with the reason, in the same commit.`); process.exit(1); }
  console.log("nothing is slower or larger than the base beyond the allowance");
}
