#!/data/data/com.termux/files/usr/bin/bash
# Run a TypeScript typecheck on the 8T (Termux) with a hard memory cap.
#
# Usage: scripts/typecheck-local.sh <target> [options] [-- extra tsc args]
#   target: ui | cli | server | protocol | agents | cli-common | transfers |
#           connection-supervisor | release-runtime | <folder with tsconfig.json>
#   --cold         delete the incremental build info first (full check)
#   --cap-mb N     kill the check when its process tree uses more than N MB RSS (default 1200)
#   --step-mb N    new source per step in a stepped check (default 6)
#   --steps        use the stepped check also when a .tsbuildinfo exists
#
# The compiler is the native TypeScript 7 compiler through
# scripts/workspaces/runTypeScriptCli.mjs (AGENTS.md, "TypeScript compiler ownership").
# It runs single-threaded, with GOMEMLIMIT and GOGC set, in incremental mode with
# the .tsbuildinfo under ~/.cache/happier-typecheck. The script samples the RSS of the
# whole process tree twice per second and kills its own process group above the cap.
#
# A full check of apps/cli or apps/ui does not fit in the cap as one program. A cold run
# is therefore a stepped check (tools/typecheck-local/steps.mjs): growing programs that
# share the .tsbuildinfo, so each step checks only new files. The last step is the full
# root file list, so its result is the result of a full check. A warm run (a .tsbuildinfo
# exists) runs only the last step; if that hits the cap, the script runs the steps.
# Measured on 17/11-2026: with the default cap of 1200 MB, apps/cli and apps/ui still
# hit the cap (parsing the full program alone needs more), so for them the script exits
# with 137. See tools/typecheck-local/RESULTAT.md.
#
# The workspace packages (packages/*/dist) must be up to date; the script warns when a
# package source is newer than its dist.
#
# Exit codes: 0 = no errors, 2 = type errors, 137 = cap hit (result NOT valid),
# 75 = too little free memory to start, other = setup error.
set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cap_mb=1200
step_mb=6
cold=0
force_steps=0
target=""
extra=()

while [ $# -gt 0 ]; do
  case "$1" in
    --cold) cold=1 ;;
    --steps) force_steps=1 ;;
    --cap-mb) shift; cap_mb="$1" ;;
    --step-mb) shift; step_mb="$1" ;;
    --) shift; extra=("$@"); break ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) target="$1" ;;
  esac
  shift
done

case "$target" in
  ui|cli|server|website|stack) dir="$repo_root/apps/$target" ;;
  "") echo "typecheck-local: missing target (ui, cli, protocol, ...)" >&2; exit 64 ;;
  *)
    if [ -d "$repo_root/packages/$target" ]; then dir="$repo_root/packages/$target"
    elif [ -f "$target/tsconfig.json" ]; then dir="$(cd "$target" && pwd)"
    else echo "typecheck-local: unknown target '$target'" >&2; exit 64
    fi ;;
esac
[ -f "$dir/tsconfig.json" ] || { echo "typecheck-local: no tsconfig.json in $dir" >&2; exit 64; }

name="$(echo "${dir#"$repo_root"/}" | tr '/' '-')"
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/happier-typecheck"
mkdir -p "$cache_dir"
buildinfo="$cache_dir/$name.tsbuildinfo"
log="$cache_dir/$name.log"
[ "$cold" = 1 ] && rm -f "$buildinfo"

# Warn when a workspace package has source files newer than its dist output.
for pkg in agents protocol cli-common connection-supervisor release-runtime transfers; do
  p="$repo_root/packages/$pkg"
  [ -f "$p/dist/index.d.ts" ] || continue
  [ "$dir" = "$p" ] && continue
  if [ -n "$(find "$p/src" -newer "$p/dist/index.d.ts" -name '*.ts' -print -quit 2>/dev/null)" ]; then
    echo "typecheck-local: WARNING packages/$pkg/dist is older than its src; rebuild it first (yarn workspace @happier-dev/$pkg build)." >&2
  fi
done

export GOMEMLIMIT="${GOMEMLIMIT:-$((cap_mb * 3 / 4))MiB}"
export GOGC="${GOGC:-25}"
export GOMAXPROCS="${GOMAXPROCS:-2}"
cap_kb=$((cap_mb * 1024))
total_start=$(date +%s.%N)
overall_peak_kb=0

# run_capped <tsconfig> <label>: one compiler run with the cap.
# Sets run_status (137 when the cap was hit).
run_capped() {
  local cfg="$1" label="$2"
  local avail_mb start pid rss_kb peak_kb=0 killed=0 secs
  avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  if [ "$avail_mb" -lt $((cap_mb + 600)) ]; then
    echo "typecheck-local: only ${avail_mb} MB available, need $((cap_mb + 600)) MB. Not started." >&2
    exit 75
  fi
  start=$(date +%s.%N)
  (cd "$dir" && exec setsid node "$repo_root/scripts/workspaces/runTypeScriptCli.mjs" \
    -p "$cfg" --noEmit --pretty false \
    --incremental --tsBuildInfoFile "$buildinfo" \
    --singleThreaded --checkers 1 \
    "${extra[@]}") >"$log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    rss_kb=$(ps -o rss= --sid "$pid" 2>/dev/null | awk '{s+=$1} END {print s+0}')
    [ "$rss_kb" -gt "$peak_kb" ] && peak_kb=$rss_kb
    if [ "$rss_kb" -gt "$cap_kb" ]; then
      kill -KILL -- "-$pid" 2>/dev/null
      killed=1
      break
    fi
    sleep 0.5
  done
  wait "$pid" 2>/dev/null
  run_status=$?
  [ "$killed" = 1 ] && run_status=137
  secs=$(awk -v a="$start" -v b="$(date +%s.%N)" 'BEGIN {printf "%.1f", b-a}')
  [ "$peak_kb" -gt "$overall_peak_kb" ] && overall_peak_kb=$peak_kb
  echo "typecheck-local: [$label] exit=$run_status peak_rss=$((peak_kb / 1024))MB time=${secs}s" >&2
}

finish() {
  local status="$1" mode="$2" secs errors
  secs=$(awk -v a="$total_start" -v b="$(date +%s.%N)" 'BEGIN {printf "%.1f", b-a}')
  if [ "$status" = 137 ]; then
    echo "typecheck-local: FAILED $target: memory cap hit (> ${cap_mb} MB) after ${secs}s. The check was killed; the result is NOT valid. Try a smaller --step-mb." >&2
    exit 137
  fi
  cat "$log"
  errors=$(grep -c 'error TS' "$log")
  echo "typecheck-local: $target ($mode) exit=$status errors=$errors peak_rss=$((overall_peak_kb / 1024))MB time=${secs}s" >&2
  if [ "$status" -ne 0 ]; then
    [ "$errors" -gt 0 ] && exit 2
    exit "$status"
  fi
  exit 0
}

# All runs use the step configs, so the compiler options (and the .tsbuildinfo) match.
steps_dir="$cache_dir/steps/$name"
mapfile -t steps < <(node "$repo_root/tools/typecheck-local/steps.mjs" "$dir" "$steps_dir" "$step_mb")
[ "${#steps[@]}" -gt 0 ] || { echo "typecheck-local: could not plan the steps" >&2; exit 70; }
full="${steps[${#steps[@]} - 1]}"

if [ "$force_steps" = 0 ] && { [ -f "$buildinfo" ] || [ "${#steps[@]}" -le 2 ]; }; then
  run_capped "$full" direct
  [ "$run_status" != 137 ] && finish "$run_status" direct
  echo "typecheck-local: the direct check hit the cap; running the stepped check." >&2
fi

i=0
for step in "${steps[@]}"; do
  i=$((i + 1))
  run_capped "$step" "step $i/${#steps[@]}"
  [ "$run_status" = 137 ] && finish 137 stepped
done
finish "$run_status" stepped
