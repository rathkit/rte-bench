// Checks a benchmark result against the budgets in budgets.json. Pure, so the test can hand it any result.
//   overBudget(results, budgets, scale) -> a list of sentences, empty when every figure present is within its budget
// A budget whose figure is not in the result is skipped (a quick run has no 20,000-paragraph document); `scale` multiplies every maximum
// (CI uses it, because a shared runner is slower than the reference machine).
export function overBudget(results, budgets, scale = 1) {
  const over = [];
  for (const [path, { stat, max, unit }] of Object.entries(budgets)) {
    const found = path.split(".").reduce((o, k) => o?.[k], results);
    if (found === undefined) continue;
    const value = stat === "value" ? found : found?.[stat];
    if (typeof value !== "number") { over.push(`${path}: no ${stat} figure`); continue; }
    if (value > max * scale) over.push(`${path}: ${value.toFixed(2)} ${unit} is over the budget of ${max * scale} ${unit}${scale === 1 ? "" : ` (${max} x ${scale})`} (${stat})`);
  }
  return over;
}
