// Turns a results file into the tables the product's docs show, so no figure is copied by hand.
//   node tools/report.mjs FILE                     prints the markdown
//   node tools/report.mjs FILE --into DOC.md       replaces what is between <!-- rte-bench:begin --> and <!-- rte-bench:end --> in DOC.md
// A figure is "median / 95th percentile" in milliseconds. A full run is required: the tables have the 20,000-paragraph and 20,000-cell columns.
import { readFileSync, writeFileSync } from "node:fs";

export const BEGIN = "<!-- rte-bench:begin -->";
export const END = "<!-- rte-bench:end -->";

const num = (x) => (x >= 100 ? String(Math.round(x)) : x.toFixed(1));
const pair = (s) => `${num(s.median)} / ${num(s.p95)}`;
const sizes = [1000, 5000, 10000, 20000];
const group = (r, key, fields) => fields.map((f) => pair(r[key][f])).join(" · ");

export function report(result) {
  const { results: r, machine: m, driver: d } = result;
  if (result.mode !== "full" || !r.p20000 || !r.t20000) throw new Error("the report needs a full run (20,000 paragraphs and 20,000 cells)");
  const n = (v) => v.toLocaleString("en-US");
  const row = (label, fields) => `| ${label} | ${sizes.map((s) => group(r, `p${s}`, fields)).join(" | ")} |`;
  const tcols = [500, 5000, 20000];
  const mb = (b, digits) => (b / 1e6).toFixed(digits);
  const slow = (key, f, rate) => pair(r[`${key}@${rate}x`][f]);
  const out = [];
  out.push(`Full run of ${result.date.slice(0, 10)} at RTE commit \`${result.rte.commit.slice(0, 7)}\` and rte-bench commit \`${result.bench.commit.slice(0, 7)}\`: ${m.class} (${m.cpu}, ${m.logicalCpus} logical CPUs in the container (cpuset ${m.cpuset}), ${m.memoryGB} GB, ${m.kernel}${m.note ? `; ${m.note}` : ""}), Node ${result.node.replace(/^v/, "")}, Chromium ${d.chromium}, Playwright ${d.playwright}, ${result.runs} runs per figure, in the pinned container (Chromium sandbox: ${result.sandbox}). Milliseconds, median / 95th percentile.`);
  out.push("");
  out.push(`| | ${sizes.map((s) => `${n(s)} paragraphs`).join(" | ")} |`);
  out.push(`| --- | ${sizes.map(() => "---").join(" | ")} |`);
  out.push(row("Load a document", ["load"]));
  out.push(row("Type (middle)", ["typeMiddle"]));
  out.push(row("Type (top · end)", ["typeTop", "typeEnd"]));
  out.push(row("Enter · join blocks", ["enter", "join"]));
  out.push(row("Paste text (3 paragraphs)", ["pasteText"]));
  out.push(row("Paste HTML (100 paragraphs)", ["pasteHtml"]));
  out.push(row("Undo · redo one step", ["undo", "redo"]));
  out.push(row("Undo, 200 steps of history", ["undoDeep"]));
  out.push("");
  out.push(`| | ${tcols.map((c) => `${n(c)} cells`).join(" | ")} |`);
  out.push(`| --- | ${tcols.map(() => "---").join(" | ")} |`);
  out.push(`| Load a table | ${tcols.map((c) => pair(r[`t${c}`].load)).join(" | ")} |`);
  out.push(`| Type in one cell | ${tcols.map((c) => pair(r[`t${c}`].type)).join(" | ")} |`);
  out.push(`| Other cells redrawn | ${tcols.map((c) => r[`t${c}`].redrawn).join(" | ")} |`);
  out.push("");
  for (const rate of [4, 6]) {
    if (!r[`p1000@${rate}x`]) continue;
    out.push(`CPU ${rate}x slower: typing in the middle of 1,000 / 5,000 paragraphs ${slow("p1000", "typeMiddle", rate)} and ${slow("p5000", "typeMiddle", rate)}; loading them ${slow("p1000", "load", rate)} and ${slow("p5000", "load", rate)}; typing in a cell of 500 / 5,000 cells ${slow("t500", "type", rate)} and ${slow("t5000", "type", rate)}.`);
    out.push("");
  }
  out.push("");
  if (r.lowMemory) {
    const caps = r.lowMemory.map((c) => `${c.heapCapMB} MB: ${c.largestThatFits.toLocaleString("en-US")} paragraphs`).join(", ");
    out.push(`Low memory (the JavaScript heap capped, so the largest document that loads and takes a keystroke): ${caps}. One attempt per size, a capacity test and not a timing; the cap is on the heap, not on the whole browser.`);
    out.push("");
  }
  if (r.markdown) {
    const m = r.markdown;
    const shape = [["paragraphs20000", "20,000 paragraphs with bold, italic and links"], ["nestedList2000", "a list nested 2,000 deep"], ["longParagraph200000", "one paragraph of 200,000 lines under a setext underline"], ["nestedQuotes60000", "60,000 lines each inside 30 nested quotes"], ["deepListLeaves120000", "a list 24 deep with 120,000 items at the bottom"]];
    out.push(`Markdown reading, the time to read pasted Markdown into blocks (in Node, without a page; median / 95th percentile in milliseconds): ${shape.filter(([key]) => m[key]).map(([key, label]) => `${label} ${pair(m[key])}`).join("; ")}.`);
    out.push("");
  }
  const c = r.cold;
  out.push(`Cold start: ready ${c.ready.median.toFixed(1)} ms (median of ${c.ready.n} runs from a new context), first load of 1,000 paragraphs ${c.firstLoad1000.median.toFixed(1)} ms, ${Math.round(c.javascriptBytes / 1024)} KB of JavaScript fetched (uncompressed, for the conformance page, which has the core and the browser view).`);
  out.push("");
  const e = r.mem;
  out.push(`Memory: empty page ${mb(e.emptyPageBytes, 2)} MB; a document adds ${mb(e.document1000Bytes, 2)} MB (1,000 paragraphs), ${mb(e.document5000Bytes, 2)} MB (5,000), ${mb(e.document10000Bytes, 1)} MB (10,000) and ${mb(e.document20000Bytes, 1)} MB (20,000); one undo step adds ${mb(e.perUndoLevelBytes, 2)} MB, ${e.perUndoLevelPercent.toFixed(2)}% of the 5,000-paragraph document.`);
  return out.join("\n");
}

export function into(doc, text) {
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`the document needs ${BEGIN} and ${END}, in that order`);
  return `${doc.slice(0, a + BEGIN.length)}\n\n${text}\n\n${doc.slice(b)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, flag, doc] = process.argv.slice(2);
  if (!file) { console.error("usage: report.mjs FILE [--into DOC.md]"); process.exit(2); }
  const text = report(JSON.parse(readFileSync(file, "utf8")));
  if (flag === "--into") writeFileSync(doc, into(readFileSync(doc, "utf8"), text));
  else console.log(text);
}
