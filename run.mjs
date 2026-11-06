// The benchmark harness: numbers, not pass or fail. It drives the built editor in Chromium and writes what it measured, with the machine
// and the method, to a JSON file and to the console as tables. README.md says how to read them.
// It runs inside the container (container/run.sh), which mounts the built editor at /rte and the limits at /limits:
//   node run.mjs --rte /rte [--limits /limits] [--results FILE] [--quick] [--scale N] [--class "name"] [--report-only] [--low-memory] [--low-memory-only]
// With --limits it also fails when a figure is over its budget (budgets.json there; CI widens them with --scale 3, because a shared runner
// is slower than the reference machine). Without it, it only reports.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { overBudget } from "./budgets.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const quick = flag("--quick");
const rteDir = option("--rte");
const limitsDir = option("--limits");
const out = option("--results") ?? option("--out");
const workDir = option("--work");
const machineClass = option("--class") ?? process.env.RTE_BENCH_CLASS ?? "unstated";
if (workDir) mkdirSync(join(workDir, "home"), { recursive: true });

const { chromium } = await import("playwright");
const playwrightVersion = JSON.parse(readFileSync(new URL("./node_modules/playwright/package.json", import.meta.url), "utf8")).version;

// --list-tools: what a run would use (the driver and the browser), then exit. CI uses it to check the image works with no network.
if (flag("--list-tools")) {
  const b = await chromium.launch(process.env.RTE_BENCH_SANDBOX === "container" ? { chromiumSandbox: false } : {});
  console.log(`playwright ${playwrightVersion}, chromium ${b.version()}, ${chromium.executablePath()}, node ${process.version}`);
  await b.close();
  process.exit(0);
}

// The editor's own page server (first-party, from the mounted tree), on a free port of the loopback interface.
let server;
let base = args.find((a) => /^https?:/.test(a));
if (!base) {
  if (!rteDir) { console.error("run.mjs needs --rte DIR (the built editor) or the address of a running page"); process.exit(2); }
  server = spawn(process.execPath, [join(rteDir, "tools/conformance/serve.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((resolve, reject) => {
    server.stdout.once("data", (d) => resolve(String(d).trim()));
    server.once("exit", (c) => reject(new Error(`page server exited with ${c}`)));
  });
  base = `http://127.0.0.1:${port}/conformance/`;
}

const plan = quick
  ? { runs: 8, paragraphs: [1000, 5000, 10000], tables: [[50, 10], [100, 50]], coldRuns: 3, throttle: [1], depth: 60 }
  : { runs: 30, paragraphs: [1000, 5000, 10000, 20000], tables: [[50, 10], [100, 50], [200, 100]], coldRuns: 10, throttle: [1, 4, 6], depth: 200 };

// Budgets (when --limits is given): a figure over one fails the run. A quick run on a shared runner widens them with --scale.
const budgets = limitsDir ? JSON.parse(readFileSync(join(limitsDir, "budgets.json"), "utf8")).budgets : undefined;
const scale = Number(option("--scale") ?? 1);

const stat = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)];
  return { n: s.length, median: at(0.5), p95: at(0.95), min: s[0], max: s[s.length - 1] };
};

// Inside the container Chromium cannot make its own sandbox (all capabilities are dropped); the container is the sandbox then, and the result says so.
const inContainer = process.env.RTE_BENCH_SANDBOX === "container";
const browser = await chromium.launch(inContainer ? { chromiumSandbox: false } : {});
const read = (file) => { try { return readFileSync(file, "utf8").trim(); } catch { return undefined; } };
const hash = (file) => { try { return createHash("sha256").update(readFileSync(file)).digest("hex"); } catch { return undefined; } };
const cpuModel = (read("/proc/cpuinfo")?.match(/^model name\s*:\s*(.+)$/m) ?? [])[1] ?? os.cpus()[0]?.model ?? "unknown";
const env = (k) => process.env[k] || undefined;
const machine = {
  class: machineClass,
  cpu: cpuModel,
  logicalCpus: os.availableParallelism(),
  cpuset: read("/sys/fs/cgroup/cpuset.cpus.effective"),
  memoryLimit: read("/sys/fs/cgroup/memory.max"),
  memoryGB: Math.round(os.totalmem() / 2 ** 30),
  kernel: os.release(),
  note: env("HOST_NOTE"),
};
const meta = {
  schema: 2,
  date: new Date().toISOString(),
  mode: quick ? "quick" : "full",
  argv: args,
  node: process.version,
  driver: { playwright: playwrightVersion, chromium: browser.version() },
  sandbox: inContainer ? "container" : "browser",
  rte: {
    commit: env("RTE_COMMIT"),
    coreSha256: rteDir ? hash(join(rteDir, "packages/rte-core/dist/index.js")) : undefined,
    viewSha256: rteDir ? hash(join(rteDir, "packages/rte-core/dist/dom/index.js")) : undefined,
  },
  bench: { commit: env("BENCH_COMMIT"), imageId: env("IMAGE_ID") },
  machine,
  load: { before: read("/proc/loadavg")?.split(" ").slice(0, 3).map(Number) },
};
const results = {};

// --- low memory: the same editor in a browser whose JavaScript heap is capped (V8 --max-old-space-size), a stand-in for a device with little memory.
// For each cap, documents of growing size are loaded and typed into until one does not fit (the page crashes or the load throws). It is a capacity
// test, one attempt per size, not a timing series; the load and keystroke times are reported as they were, not as medians.
const heapCaps = [128, 256];
const lowSizes = [1000, 5000, 10000, 20000, 40000, 80000, 160000];
async function lowMemory() {
  const out = [];
  for (const cap of heapCaps) {
    const b = await chromium.launch({ ...(inContainer ? { chromiumSandbox: false } : {}), args: [`--js-flags=--max-old-space-size=${cap}`] });
    const documents = [];
    for (const n of lowSizes) {
      const context = await b.newContext();
      await context.route("**/*", (route) => (/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(route.request().url()) ? route.continue() : route.abort()));
      const page = await context.newPage();
      let crashed = false;
      page.on("crash", () => { crashed = true; });
      try {
        await page.goto(base);
        await page.waitForFunction("window.__confReady===true");
        const client = await context.newCDPSession(page);
        const r = await page.evaluate(`(() => { ${helpers} const load = time(() => ed.setHtml(doc(${n}))); at(${Math.floor(n / 2)}, 3); const type = time(input("insertText", "x")); return { load, type }; })()`);
        const heap = (await client.send("Runtime.getHeapUsage")).usedSize;
        documents.push({ paragraphs: n, ok: true, loadMs: r.load, typeMs: r.type, heapBytes: heap });
      } catch (e) {
        documents.push({ paragraphs: n, ok: false, error: crashed ? "page crashed" : String(e.message).split("\n")[0].slice(0, 120) });
      }
      await context.close().catch(() => {});
      if (!documents[documents.length - 1].ok) break;
    }
    await b.close();
    const fits = documents.filter((d) => d.ok).at(-1)?.paragraphs ?? 0;
    out.push({ heapCapMB: cap, largestThatFits: fits, documents });
  }
  return out;
}

async function fresh() {
  const context = await browser.newContext();
  await context.route("**/*", (route) => (/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(route.request().url()) ? route.continue() : route.abort()));
  const page = await context.newPage();
  const started = Date.now();
  await page.goto(base);
  await page.waitForFunction("window.__confReady===true");
  const ready = await page.evaluate(() => performance.now());
  return { context, page, ready, wall: Date.now() - started };
}

// --- cold start: a new browser context each time (nothing cached), from navigation to the editor being ready, and the first load of a document
// (which pays for compiling the code). Also how much JavaScript the page fetched.
{
  const ready = [], first = [];
  let bytes = 0;
  for (let i = 0; i < plan.coldRuns; i++) {
    const t = await fresh();
    ready.push(t.ready);
    first.push(await t.page.evaluate(() => {
      const html = Array.from({ length: 1000 }, (_, k) => `<p>Paragraph ${k} has <strong>bold words</strong> and <em>emphasis</em>.</p>`).join("");
      const s = performance.now();
      window.__editor.setHtml(html);
      document.getElementById("ed").getBoundingClientRect();
      return performance.now() - s;
    }));
    bytes = await t.page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".js")).reduce((n, r) => n + r.decodedBodySize, 0));
    await t.context.close();
  }
  results.cold = { ready: stat(ready), firstLoad1000: stat(first), javascriptBytes: bytes };
}

// The page-side measuring helpers, given to the page as source so every scenario uses the same ones.
const helpers = `
  const el = document.getElementById("ed"), ed = window.__editor;
  const time = (fn) => { const s = performance.now(); fn(); el.getBoundingClientRect(); return performance.now() - s; };
  const input = (inputType, data) => () => el.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
  const at = (k, offset) => window.__conf.select({ start: "p:nth-child(" + k + ")", so: offset, eo: offset });
  const para = (i) => "<p>Paragraph " + i + " has <strong>bold words</strong>, some <em>emphasis</em> and a <a href=\\"https://example.com/" + i + "\\">link</a> in about ninety characters.</p>";
  const doc = (n) => Array.from({ length: n }, (_, i) => para(i)).join("");
  const series = (runs, prepare, command) => { const xs = []; for (let i = 0; i < runs; i++) { prepare(i); xs.push(time(command)); } return xs; };
`;

async function paragraphs(page, n) {
  return page.evaluate(`(async () => {
    ${helpers}
    const runs = ${plan.runs}, n = ${n}, depth = ${plan.depth}, o = {};
    const html = doc(n);
    ed.setHtml(html);
    o.load = series(runs, () => {}, () => ed.setHtml(html));
    o.typeMiddle = series(runs, () => at(Math.floor(n / 2), 3), input("insertText", "x"));
    o.typeTop = series(runs, () => at(2, 3), input("insertText", "x"));
    o.typeEnd = series(runs, () => at(n, 3), input("insertText", "x"));
    o.enter = series(runs, () => at(2, 3), input("insertParagraph"));
    o.join = series(runs, () => at(3, 0), input("deleteContentBackward"));
    o.pasteText = series(runs, () => at(2, 3), () => ed.paste({ text: "one\\n\\ntwo\\n\\nthree" }));
    const pasted = doc(100);
    o.pasteHtml = series(runs, () => at(2, 3), () => ed.paste({ html: pasted }));
    // Undo and redo of one step (a line break each time, so each is a step of its own).
    ed.setHtml(html);
    o.undo = []; o.redo = [];
    for (let i = 0; i < runs; i++) { at(2, 3); input("insertParagraph")(); o.undo.push(time(() => ed.undo())); o.redo.push(time(() => ed.redo())); ed.undo(); }
    // Undo with a long history behind it.
    ed.setHtml(html);
    for (let i = 0; i < depth; i++) { at(2, 3); input("insertParagraph")(); }
    o.undoDeep = series(Math.min(runs, depth), () => {}, () => ed.undo());
    return o;
  })()`);
}

async function table(page, rows, cols) {
  return page.evaluate(`(() => {
    ${helpers}
    const runs = ${plan.runs}, r = ${rows}, c = ${cols};
    const cell = (i, j) => "<td>Cell " + i + "-" + j + " with <strong>bold</strong> and <em>italic</em> words</td>";
    const html = "<table><tbody>" + Array.from({ length: r }, (_, i) => "<tr>" + Array.from({ length: c }, (_, j) => cell(i, j)).join("") + "</tr>").join("") + "</tbody></table><p>after</p>";
    const o = { load: series(Math.min(runs, 8), () => {}, () => ed.setHtml(html)) };
    [...el.querySelectorAll("td")].forEach((td) => { td.__kept = true; });
    o.type = series(runs, () => window.__conf.select({ start: "tr:nth-child(" + Math.floor(r / 2) + ") td:nth-child(" + Math.floor(c / 2) + ") p", so: 3, eo: 3 }), input("insertText", "x"));
    o.redrawn = [...el.querySelectorAll("td")].filter((td) => !td.__kept).length - 1;
    return o;
  })()`);
}

for (const rate of plan.throttle) {
  const t = await fresh();
  const client = await t.context.newCDPSession(t.page);
  await client.send("Emulation.setCPUThrottlingRate", { rate });
  const suffix = rate === 1 ? "" : `@${rate}x`;
  for (const n of plan.paragraphs) {
    if (rate !== 1 && n > 5000) continue;
    const r = await paragraphs(t.page, n);
    results[`p${n}${suffix}`] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, stat(v)]));
  }
  for (const [rows, cols] of plan.tables) {
    if (rate !== 1 && rows * cols > 5000) continue;
    const r = await table(t.page, rows, cols);
    results[`t${rows * cols}${suffix}`] = { load: stat(r.load), type: stat(r.type), redrawn: r.redrawn };
  }
  await t.context.close();
}

// --- low memory (full runs, or alone with --low-memory-only)
if (!quick || flag("--low-memory") || flag("--low-memory-only")) {
  results.lowMemory = await lowMemory();
  for (const c of results.lowMemory) console.log(`low memory, heap capped at ${c.heapCapMB} MB: documents up to ${c.largestThatFits.toLocaleString("en-US")} paragraphs load and take a keystroke${c.documents.at(-1).ok ? "" : `; ${c.documents.at(-1).paragraphs.toLocaleString("en-US")} did not (${c.documents.at(-1).error})`}`);
  if (flag("--low-memory-only")) { await browser.close(); server?.kill(); if (out) writeFileSync(out, `${JSON.stringify({ ...meta, mode: "low-memory", results }, null, 2)}\n`); process.exit(0); }
}

// --- memory: the heap after a forced collection, for an empty page, for each size of document, and per undo level.
{
  const t = await fresh();
  const client = await t.context.newCDPSession(t.page);
  await client.send("HeapProfiler.enable");
  const heap = async () => { await client.send("HeapProfiler.collectGarbage"); return (await client.send("Runtime.getHeapUsage")).usedSize; };
  const empty = await heap();
  const mem = { emptyPageBytes: empty };
  for (const n of plan.paragraphs) {
    await t.page.evaluate(`(() => { ${helpers} ed.setHtml(""); })()`);
    const before = await heap();
    await t.page.evaluate(`(() => { ${helpers} ed.setHtml(doc(${n})); })()`);
    const withDoc = await heap();
    mem[`document${n}Bytes`] = withDoc - before;
    if (n === 5000) {
      await t.page.evaluate(`(() => { ${helpers} at(2500, 3); for (let i = 0; i < 100; i++) input("insertLineBreak")(); })()`);
      mem.perUndoLevelBytes = ((await heap()) - withDoc) / 100;
      mem.perUndoLevelPercent = (mem.perUndoLevelBytes / mem.document5000Bytes) * 100;
    }
  }
  results.mem = mem;
  await t.context.close();
}
await browser.close();

// --- report
const f = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
meta.load.after = read("/proc/loadavg")?.split(" ").slice(0, 3).map(Number);
meta.runs = plan.runs;
console.log(`machine class: ${machine.class} | ${machine.cpu}, ${machine.logicalCpus} logical CPUs${machine.cpuset ? ` (cpuset ${machine.cpuset})` : ""}, ${machine.memoryGB} GB | kernel ${machine.kernel} | Node ${meta.node} | Chromium ${meta.driver.chromium} | Playwright ${meta.driver.playwright} | rte ${meta.rte.commit ?? "unknown"} | ${meta.mode} run, ${plan.runs} runs per figure | load ${meta.load.before?.join(" ")} -> ${meta.load.after?.join(" ")}`);
console.log(`cold start: ready ${f(results.cold.ready.median)} ms (median of ${plan.coldRuns}), first load of 1,000 paragraphs ${f(results.cold.firstLoad1000.median)} ms, ${(results.cold.javascriptBytes / 1024).toFixed(0)} KB of JavaScript`);
for (const [name, r] of Object.entries(results)) {
  if (name === "cold" || name === "mem" || name === "lowMemory") continue;
  console.log(`\n${name}  (median / p95 ms)`);
  for (const [k, v] of Object.entries(r)) if (typeof v === "object") console.log(`  ${k.padEnd(12)} ${f(v.median).padStart(7)} / ${f(v.p95).padStart(7)}`);
  if ("redrawn" in r) console.log(`  other cells redrawn when typing: ${r.redrawn}`);
}
console.log(`\nmemory: ${Object.entries(results.mem).map(([k, v]) => `${k} ${k.endsWith("Percent") ? v.toFixed(2) : (v / 1e6).toFixed(2) + " MB"}`.replace("Bytes", "")).join(", ")}`);

if (out) writeFileSync(out, `${JSON.stringify({ ...meta, results }, null, 2)}\n`);
server?.kill();

if (!budgets || flag("--report-only")) { console.log(`\nreport only: ${budgets ? "budgets not checked" : "no limits given"}`); process.exit(0); }
// A full run produces every figure, so a budget that names a figure it did not produce is a mistake in budgets.json, not a skipped check.
const unknown = quick ? [] : Object.keys(budgets).filter((p) => p.split(".").reduce((o, k) => o?.[k], results) === undefined);
if (unknown.length) { console.log(`\nBUDGETS FOR FIGURES THIS RUN DOES NOT PRODUCE\n  ${unknown.join("\n  ")}`); process.exit(1); }
const over = overBudget(results, budgets, scale);
if (over.length) { console.log(`\nOVER BUDGET\n  ${over.join("\n  ")}`); process.exit(1); }
console.log(`\nwithin every budget${scale === 1 ? "" : ` (scaled by ${scale})`}`);
