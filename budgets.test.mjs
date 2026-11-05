import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { overBudget } from "./budgets.mjs";

const { budgets } = JSON.parse(readFileSync(new URL("./fixtures/budgets.json", import.meta.url), "utf8"));
const stat = (median, p95 = median) => ({ n: 30, median, p95, min: median, max: p95 });

test("a figure over its budget is reported, one within it is not", () => {
  assert.deepEqual(overBudget({ p1000: { typeMiddle: stat(1, 4.9) } }, budgets), []);
  const over = overBudget({ p1000: { typeMiddle: stat(1, 5.1) } }, budgets);
  assert.equal(over.length, 1);
  assert.match(over[0], /^p1000\.typeMiddle: 5\.10 ms is over the budget of 5 ms/);
});

test("the scale widens every maximum, and a figure that is not in the result is skipped", () => {
  assert.deepEqual(overBudget({ p1000: { typeMiddle: stat(1, 12) } }, budgets, 3), []);
  assert.equal(overBudget({ p1000: { typeMiddle: stat(1, 16) } }, budgets, 3).length, 1);
  assert.deepEqual(overBudget({}, budgets), []);
});

test("cold start is held to the median, memory and cell counts to their value", () => {
  assert.equal(overBudget({ cold: { ready: stat(300, 10) } }, budgets).length, 1);
  assert.equal(overBudget({ mem: { perUndoLevelPercent: 1.5 } }, budgets).length, 1);
  assert.equal(overBudget({ t5000: { redrawn: 1 } }, budgets).length, 1);
  assert.deepEqual(overBudget({ cold: { ready: stat(200, 900) }, mem: { perUndoLevelPercent: 0.4 }, t5000: { redrawn: 0 } }, budgets), []);
});

test("every budget names a figure the harness produces", () => {
  const source = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  for (const path of Object.keys(budgets)) {
    // The harness builds some names from the size ("document" + n + "Bytes"), so each part around a number is looked for.
    for (const part of path.split(".").pop().split(/\d+/).filter(Boolean)) assert.ok(source.includes(part), `${path}: run.mjs never produces "${part}"`);
  }
  for (const { stat: s, max } of Object.values(budgets)) {
    assert.ok(["p95", "median", "value"].includes(s));
    assert.ok(typeof max === "number" && max >= 0);
  }
});
