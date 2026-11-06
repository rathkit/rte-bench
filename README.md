# Rathkit RTE benchmarks

**Report problems with the benchmarks as an issue in [rathkit/rte](https://github.com/rathkit/rte/issues) (label `benchmarks`). Outside pull requests are not taken in this repository.**

The runner and the container recipe for the speed and memory figures of [Rathkit RTE](https://github.com/rathkit/rte). The figures themselves are published in RTE's `docs/MEASUREMENTS.md`, each naming the commit of this repository and the file in `published/` that produced it. The budgets the editor holds itself to, the recorded sizes and the approved increases are in the RTE repository too; this repository only measures and compares.

A benchmark runs **only inside a throwaway container**: an image pinned by digest, built from a lockfile with no install scripts, no network during the run, all capabilities dropped, a non-root user, the built editor and the limits mounted read-only, one folder to write results to. Nothing it installs touches a working tree.

## Run it

You need Docker (or Podman, with `CONTAINER=podman`) and a checkout of `rathkit/rte` that has been built (`pnpm build` there).

```sh
# One run of the full method:
container/run.sh run --rte ../rte -- --class "what this machine is"

# The reduced run, with the editor's budgets applied (the same flags CI uses):
container/run.sh run --rte ../rte --limits ../rte/tools/bench -- --quick --scale 3

# The regression gate: measure the base commit and this one on this machine, and compare:
container/run.sh gate --rte ../rte --base ../rte-base --limits ../rte/tools/bench
```

Results go to `results/` (not committed). `CPUSET` (default `2-9`), `MEMORY` (default `12g`) and `HOST_NOTE` (free text recorded with the result, for example `WSL2, Docker Desktop, laptop on AC`) set the limits and the note.

To make a result that may be published, add `--publish`: it refuses a dirty tree, a dirty RTE checkout, fewer than 7 runs, and a machine whose one-minute load is 1.0 or more. Commit the file under `published/` as `YYYY-MM-DD-<rte sha>-<bench sha>.json`. A figure from CI, from a working tree or from the host is never published. `node tools/report.mjs FILE --into DOC.md` writes the tables for the product's docs between `<!-- rte-bench:begin -->` and `<!-- rte-bench:end -->`, so no figure is copied by hand.

## Method

- **Each figure is a series of runs** (30 in a full run, 8 in a quick one), reported as the median and the 95th percentile, in milliseconds. A command is timed from the call to the page having its layout (`getBoundingClientRect` is read after it). Commands go through the editor's own entry points (`beforeinput` events, `paste`, `undo`), not through synthesized keystrokes, so the figure is the editor's work plus the browser's layout, without the browser's input pipeline.
- **Documents.** Paragraphs of about 90 characters with bold, italic and a link, at 1,000, 5,000, 10,000 and 20,000 of them. Tables of 500, 5,000 and 20,000 cells, each cell with bold and italic text.
- **Scenarios.** Load (`setHtml`, warm); typing in the middle, at the top and at the end; Enter; joining blocks; pasting plain text (three paragraphs) and HTML (a hundred paragraphs); undo and redo of one step; undo with a history of 200 steps behind it; typing in a table cell, with a count of the other cells that were redrawn (it must be none).
- **Cold start.** A new browser context for each run, so nothing is cached: from navigation to the editor being ready, then the first load of 1,000 paragraphs (which pays for compiling the code), and the JavaScript the page fetched (uncompressed). "Cold" means no cache kept by the browser; the operating system's file cache is warm.
- **Memory.** The heap in use after a forced collection: an empty page, then with each size of document, then with 100 undo steps added. No other measurement runs at the same time.
- **Slow device.** The full run repeats the paragraph and table scenarios with the CPU throttled four times (`@4x`) and six times (`@6x`), the settings commonly used for a mid-range and a low-end phone. That is Chromium's throttling, a stand-in for a slow device and not a measurement of one.
- **Low memory.** The full run repeats a load and one keystroke in a browser whose JavaScript heap is capped at 128 MB and at 256 MB (V8's `--max-old-space-size`), with documents of 1,000 paragraphs doubling up to 160,000, and records the largest that works before the page crashes. One attempt per size: it is a capacity test, not a timing. The cap is on the heap, not on the whole browser process, so it says how much document a device with that much heap can hold, not how much RAM the device needs.
- **Comparison with a base commit (the gate).** The base and the change are measured one after the other, on the same machine, twice each, and the lower figure of the two counts. A timing fails when it is both 1.5 times the base and more than 2 ms slower; memory and fetched JavaScript fail at 1.1 times and 300 KB more. An increase that was approved is listed, with its reason, in the RTE repository's `tools/bench/accepted.json`.
- **Machine record.** Every result records the date, the RTE commit and hashes of its built files, this repository's commit, the image ID, the driver and browser versions, Node, the CPU, the logical CPUs, the cpuset, the memory limit, the kernel, a free-text note, the load before and after, the number of runs and the exact arguments.

## Caveats

- One machine, one run's worth of noise. A figure is comparable only with another from the same machine class and the same method.
- Under Windows with WSL2, the container runs in the same virtual machine as the distribution. `--cpuset-cpus` pins the container to the machine's virtual CPUs, but the host still moves those across physical cores; load on the Windows side does not show in `/proc/loadavg`. Pinning lowers noise; it does not isolate.
- The browser runs with its own sandbox off, because a container with every capability dropped cannot make one. The container is the sandbox then, and each result says `"sandbox": "container"`. On Docker Desktop a container is isolation, not a security boundary against a determined attacker.
- Output and the browser profile are on memory-backed storage, so disk speed is out of every figure alike.
- The numbers from CI (`smoke`) come from a shared runner and one run. They show that the recipe works. They are never published.
- Figures from the container are not mixed with figures from other methods in one table.

## Reproduce a published figure

Check out this repository at the commit the figure names, check out RTE at the commit it names and build it, then run with the same arguments, the same `CPUSET` and the same note. Built-file hashes in the result tell you whether the RTE build is the same one.

## Results file

`schema: 2`. Top level: `date`, `mode`, `argv`, `node`, `driver` (`playwright`, `chromium`), `sandbox`, `rte` (`commit`, `coreSha256`, `viewSha256`), `bench` (`commit`, `imageId`), `machine` (`class`, `cpu`, `logicalCpus`, `cpuset`, `memoryLimit`, `memoryGB`, `kernel`, `note`), `load` (`before`, `after`), `runs`, and `results` (the figures: `cold`, `p<N>` for paragraphs, `t<N>` for tables, with `@4x` and `@6x` for throttled, `mem`, and `lowMemory`, a list with the heap cap and the largest document that fits). `node tools/check-results.mjs FILE` refuses a file that lacks any of these.

## Bumping a version or a digest

The base image, the Dockerfile frontend and pnpm are pinned by digest or checksum in `container/Containerfile`, each with its tag beside it. The browser driver is pinned in `package.json` and `pnpm-lock.yaml`, and the image tag must carry the same version. A bump is one commit with a full run before and after (see CONTRIBUTING.md).
