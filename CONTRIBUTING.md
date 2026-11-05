# Contributing to the Rathkit RTE benchmarks

**Report problems with the benchmarks as an issue in [rathkit/rte](https://github.com/rathkit/rte/issues) (label `benchmarks`). Issues and pull requests are turned off in this repository, and outside pull requests are not taken here.** Only the owner pushes to `main`. The rest of this page is for the owner and for anyone who works from a fork on their own copy.

## What this repository is

The runner and the container recipe for the benchmarks of Rathkit RTE, and the results published from them. The editor itself, the budgets it holds itself to (`tools/bench/budgets.json`), the recorded sizes and the approved increases stay in [rathkit/rte](https://github.com/rathkit/rte); the published figures are in its `docs/MEASUREMENTS.md`, each naming the commit and file in this repository that produced it.

## Changing the benchmark

- A benchmark is run only through `container/run.sh`. A figure from a working tree, from the host or from CI is never published. CI runs here only show that the recipe works.
- A change to a tool's options, to a version or to a digest needs a reason, a full container run before and after, and the two tables in the commit message.
- Run `container/run.sh run --publish` to make a result that may be published; it refuses a dirty tree, fewer than 7 runs and a machine that is not idle. Commit the result under `published/` with `docs(published): <date> run of rte <sha>`.
- Keep the method text in `README.md` true to the code. The words the project does not use (see the Code of Conduct and the AI policy) apply to every file here.

## Commits

- `type(scope): subject`, in the Conventional Commits style (`feat`, `fix`, `docs`, `test`, `perf`, `refactor`, `chore`, `ci`, `build`, `style`), imperative, lower case after the colon, no trailing period. American English.
- Every commit carries a verified GPG signature (`git commit -S`) and a DCO sign-off (`git commit -s`, the [DCO](DCO)). No other trailers; see the [AI policy](AI_POLICY.md).
- Use pnpm, never npm, yarn or corepack.

## License

Apache-2.0 (see [LICENSE](LICENSE)). The copyright holder is named in [NOTICE](NOTICE).
