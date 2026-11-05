import assert from "node:assert/strict";
import { test } from "node:test";
import { figures, regressions } from "./compare.mjs";

const stat = (median) => ({ n: 8, median, p95: median * 1.2, min: median, max: median * 1.3 });
const run = (typeMiddle, load = 20, heap = 5_000_000) => ({ p5000: { typeMiddle: stat(typeMiddle), load: stat(load) }, mem: { document5000Bytes: heap, perUndoLevelPercent: 0.4 }, cold: { javascriptBytes: 390_000, ready: stat(80) } });

test("a command twice as slow and more than 2 ms slower fails; the same command a little slower does not", () => {
  const found = regressions([run(6)], [run(12)]);
  assert.equal(found.length, 1);
  assert.match(found[0], /^p5000\.typeMiddle: 6\.0 ms became 12\.0 ms \(2\.00x; allowed 1\.5x and more than 2 ms/);
  assert.deepEqual(regressions([run(6)], [run(8.9)]), []);
});

test("a small figure that doubles is noise, not a regression (under the floor)", () => {
  assert.deepEqual(regressions([run(0.9)], [run(1.9)]), []);
});

test("memory and fetched JavaScript are held too, and best-of-several runs absorbs one noisy run", () => {
  assert.match(regressions([run(6)], [run(6, 20, 6_400_000)])[0], /^mem\.document5000Bytes: 5000000 bytes became 6400000 bytes/);
  assert.equal(regressions([run(6)], [{ ...run(6), cold: { javascriptBytes: 800_000, ready: stat(80) } }]).length, 1);
  assert.deepEqual(regressions([run(6), run(6.2)], [run(30), run(6.5)]), [], "the quieter head run counts");
  assert.equal(regressions([run(6), run(6.2)], [run(30), run(31)]).length, 1);
});

test("an approved ratio for a figure lifts the limit for that figure only", () => {
  const accepted = { "p5000.typeMiddle": { ratio: 3, reason: "x" } };
  assert.deepEqual(regressions([run(6)], [run(12)], accepted), []);
  assert.equal(regressions([run(6)], [run(20)], accepted).length, 1);
  assert.equal(regressions([run(6, 20)], [run(12, 60)], accepted).length, 1);
});

test("every figure the harness reports as a timing or a byte count is seen", () => {
  const seen = figures({ cold: { ready: stat(1), javascriptBytes: 5 }, mem: { emptyPageBytes: 9, perUndoLevelPercent: 0.4 }, t500: { load: stat(2), redrawn: 0 } });
  assert.deepEqual(Object.keys(seen).sort(), ["cold.javascriptBytes", "cold.ready", "mem.emptyPageBytes", "t500.load"]);
});
