#!/usr/bin/env bash
# The only way to make a run. Builds the image from the pinned recipe, then runs the harness in a throwaway container: no network, all
# capabilities dropped, a non-root user, the built editor and the limits mounted read-only, one results folder writable.
#
#   container/run.sh run  --rte DIR [--limits DIR] [--publish] [--] [run.mjs options...]
#   container/run.sh gate --rte DIR --base DIR --limits DIR [--scale N]
#
# --rte DIR     a checkout of rathkit/rte after `pnpm build` (packages/*/dist, conformance page, tools/conformance/serve.mjs)
# --base DIR    the same for the commit the change builds on (gate only)
# --limits DIR  the folder with the product's budgets.json and accepted.json
# --publish     refuses a dirty tree, fewer than 7 runs, a dirty rte checkout, or a machine that is not idle; the result may be published
# gate          measures base, head, base, head (quick runs), fails when the head is over a budget or slower than the base beyond the allowance
# Environment:  CONTAINER=docker|podman  CPUSET=2-9  MEMORY=12g  HOST_NOTE="WSL2, Docker Desktop 29.9.2, laptop on AC"
set -eu
engine=${CONTAINER:-docker}
here=$(cd "$(dirname "$0")/.." && pwd)
mode=${1:?usage: run.sh run|gate --rte DIR ...}; shift
rte= base= limits= publish= scale=3
while [ $# -gt 0 ]; do
  case $1 in
    --rte) rte=$(cd "$2" && pwd); shift 2 ;;
    --base) base=$(cd "$2" && pwd); shift 2 ;;
    --limits) limits=$(cd "$2" && pwd); shift 2 ;;
    --publish) publish=1; shift ;;
    --scale) scale=$2; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ -n "$rte" ] || { echo "run.sh: --rte DIR is required" >&2; exit 2; }
[ -f "$rte/tools/conformance/serve.mjs" ] || { echo "run.sh: $rte has no tools/conformance/serve.mjs" >&2; exit 2; }
[ -f "$rte/packages/rte-core/dist/index.js" ] || { echo "run.sh: $rte is not built (run pnpm build there)" >&2; exit 2; }

bench_commit=$(git -C "$here" rev-parse HEAD)
rte_commit=$(git -C "$rte" rev-parse HEAD)
load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)
if [ -n "$publish" ]; then
  [ -z "$(git -C "$here" status --porcelain)" ] || { echo "run.sh --publish: the rte-bench tree has uncommitted changes" >&2; exit 1; }
  [ -z "$(git -C "$rte" status --porcelain --untracked-files=no)" ] || { echo "run.sh --publish: the rte checkout has uncommitted changes" >&2; exit 1; }
  awk -v l="$load" 'BEGIN { exit !(l < 1.0) }' || { echo "run.sh --publish: the machine is not idle (load $load, needs below 1.0)" >&2; exit 1; }
elif awk -v l="$load" 'BEGIN { exit !(l >= 1.0) }'; then
  echo "run.sh: warning: the machine is not idle (load $load); the figures are not publishable" >&2
fi

image=rte-bench:$bench_commit
"$engine" build --quiet --build-arg BENCH_COMMIT="$bench_commit" -t "$image" -f "$here/container/Containerfile" "$here" > /dev/null
image_id=$("$engine" image inspect --format '{{.Id}}' "$image")
mkdir -p "$here/results"

user=(--user "$(id -u):$(id -g)")
[ "$engine" = podman ] && user=(--userns=keep-id)
launch() { # launch NAME RTE_DIR [run.mjs options...]
  name=$1; dir=$2; shift 2
  mounts=(-v "$dir":/rte:ro -v "$here/results":/results:rw)
  [ -n "$limits" ] && mounts+=(-v "$limits":/limits:ro)
  "$engine" run --rm --name "rte-bench-$name-$$" \
    --network none --cap-drop ALL --security-opt no-new-privileges "${user[@]}" \
    --memory "${MEMORY:-12g}" --memory-swap "${MEMORY:-12g}" --pids-limit 4096 --shm-size 2g \
    --cpuset-cpus "${CPUSET:-2-9}" \
    --tmpfs /work:rw,exec,size=2g --tmpfs /tmp:rw,exec,size=1g -e HOME=/work/home \
    "${mounts[@]}" \
    -e RTE_COMMIT="$(git -C "$dir" rev-parse HEAD)" -e BENCH_COMMIT="$bench_commit" -e IMAGE_ID="$image_id" -e HOST_NOTE="${HOST_NOTE:-}" \
    "$image" --rte /rte --work /work "$@"
}

stamp=$(date -u +%Y%m%dT%H%M%SZ)
case $mode in
  run)
    opts=("$@")
    [ -n "$limits" ] && opts+=(--limits /limits)
    launch run "$rte" --results "/results/$stamp.json" "${opts[@]}"
    echo "results: results/$stamp.json (rte $rte_commit, rte-bench $bench_commit)"
    ;;
  gate)
    [ -n "$base" ] && [ -n "$limits" ] || { echo "run.sh gate: --base DIR and --limits DIR are required" >&2; exit 2; }
    cls="${GATE_CLASS:-unstated}"
    launch base "$base" --quick --report-only --class "$cls" --results "/results/$stamp-base-1.json" > /dev/null
    launch head "$rte" --quick --scale "$scale" --limits /limits --class "$cls" --results "/results/$stamp-head-1.json"
    launch base "$base" --quick --report-only --class "$cls" --results "/results/$stamp-base-2.json" > /dev/null
    launch head "$rte" --quick --report-only --class "$cls" --results "/results/$stamp-head-2.json" > /dev/null
    # The comparison needs no browser; it runs in the same image, on the results folder.
    "$engine" run --rm --network none --cap-drop ALL "${user[@]}" -v "$here/results":/results:ro -v "$limits":/limits:ro --entrypoint node "$image" \
      /bench/compare.mjs "/results/$stamp-base-1.json,/results/$stamp-base-2.json" "/results/$stamp-head-1.json,/results/$stamp-head-2.json" --accepted /limits/accepted.json
    ;;
  *) echo "run.sh: unknown mode $mode" >&2; exit 2 ;;
esac
