import assert from "node:assert/strict";
import { test } from "node:test";
import { BEGIN, END, into, report } from "./report.mjs";

const s = (median, p95 = median) => ({ n: 30, median, p95, min: median, max: p95 });
const paragraphs = () => ({ load: s(19.94, 26.8), typeMiddle: s(0.9, 2.5), typeTop: s(0.9, 1), typeEnd: s(1, 1.1), enter: s(1), join: s(1), pasteText: s(1.1), pasteHtml: s(4.6, 209.4), undo: s(0.8), redo: s(0.8), undoDeep: s(0.9) });
const table = () => ({ load: s(18.1, 1359.4), type: s(5.1, 6.1), redrawn: 0 });
const result = () => ({
  mode: "full", date: "2026-11-06T14:00:00Z", node: "v26.13.0", runs: 30, sandbox: "container", driver: { chromium: "156", playwright: "1.64.1" },
  rte: { commit: "a".repeat(40) }, bench: { commit: "b".repeat(40) },
  machine: { class: "laptop", cpu: "CPU", logicalCpus: 8, cpuset: "2-9", memoryGB: 31, kernel: "6.18", note: "" },
  results: {
    p1000: paragraphs(), p5000: paragraphs(), p10000: paragraphs(), p20000: paragraphs(),
    "p1000@4x": paragraphs(), "p5000@4x": paragraphs(), t500: table(), t5000: table(), t20000: table(), "t500@4x": table(), "t5000@4x": table(),
    cold: { ready: s(77.44), firstLoad1000: s(25.3), javascriptBytes: 392812 },
    mem: { emptyPageBytes: 1725304, document1000Bytes: 1490784, document5000Bytes: 5778172, document10000Bytes: 10168576, document20000Bytes: 21990000, perUndoLevelBytes: 23111.72, perUndoLevelPercent: 0.3999 },
  },
});

test("figures are median / 95th percentile, one decimal below 100 and whole above", () => {
  const text = report(result());
  assert.match(text, /\| Load a document \| 19\.9 \/ 26\.8 \|/);
  assert.match(text, /\| Paste HTML \(100 paragraphs\) \| 4\.6 \/ 209 \|/);
  assert.match(text, /\| Load a table \| 18\.1 \/ 1359 \|/);
  assert.match(text, /Cold start: ready 77\.4 ms \(median of 30 runs/);
  assert.match(text, /384 KB of JavaScript/);
  assert.match(text, /Memory: empty page 1\.73 MB; a document adds 1\.49 MB .* 10\.2 MB \(10,000\) and 22\.0 MB \(20,000\); one undo step adds 0\.02 MB, 0\.40%/);
  assert.match(text, /^Full run of 2026-11-06 at RTE commit `aaaaaaa` and rte-bench commit `bbbbbbb`/);
});

test("a quick run is refused", () => {
  const quick = result();
  quick.mode = "quick";
  assert.throws(() => report(quick), /full run/);
});

test("into replaces only what is between the markers", () => {
  const doc = `before\n${BEGIN}\n\nold\n\n${END}\nafter\n`;
  assert.equal(into(doc, "new"), `before\n${BEGIN}\n\nnew\n\n${END}\nafter\n`);
  assert.throws(() => into("no markers", "x"), /needs/);
});
