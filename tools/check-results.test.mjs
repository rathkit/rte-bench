import assert from "node:assert/strict";
import { test } from "node:test";
import { problems } from "./check-results.mjs";

const sha = "a".repeat(40);
const good = () => ({
  schema: 2, date: "2026-11-05T00:00:00.000Z", mode: "full", argv: [], node: "v26", driver: { playwright: "1.64.1", chromium: "156" }, sandbox: "container",
  rte: { commit: sha, coreSha256: "x", viewSha256: "y" }, bench: { commit: sha, imageId: "sha256:z" },
  machine: { cpu: "c", logicalCpus: 8, kernel: "k" }, load: { before: [0.2, 0.1, 0], after: [0.5, 0.2, 0.1] }, runs: 30, results: { cold: {}, mem: {} },
});

test("a complete full run is accepted, also as publishable", () => {
  assert.deepEqual(problems(good()), []);
  assert.deepEqual(problems(good(), { publishable: true }), []);
});

test("a missing field is named", () => {
  const r = good();
  delete r.rte.coreSha256;
  r.bench.imageId = null;
  assert.deepEqual(problems(r), ["missing rte.coreSha256", "missing bench.imageId"]);
});

test("a result is publishable only from a full, idle run of 7 or more with full commits", () => {
  assert.equal(problems({ ...good(), runs: 6 }, { publishable: true }).length, 1);
  assert.equal(problems({ ...good(), mode: "quick" }, { publishable: true }).length, 1);
  assert.equal(problems({ ...good(), load: { before: [1.2], after: [1] } }, { publishable: true }).length, 1);
  assert.equal(problems({ ...good(), rte: { ...good().rte, commit: "abc" } }, { publishable: true }).length, 1);
  assert.deepEqual(problems({ ...good(), runs: 6 }), []);
});
