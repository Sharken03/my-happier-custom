#!/usr/bin/env node
// Typechecks one workspace in Termux without letting Android's low-memory killer stop Termux.
//
// A plain `typecheck` runs tsgo with a checker per core; on the 8T (7.5 GB, ~3.5 GB free) that made
// Android kill all of Termux twice on 9/11-2026. This runs tsgo single-threaded with a Go soft memory
// limit, and stops the whole process tree when its resident memory passes --max-mb, before Android
// steps in. It prints the peak.
//
// Measured 9/11-2026 (single-threaded, GOGC=40): packages/protocol peaks at about 400 MB in 7 s.
// apps/cli passed 2800 MB after 90 s and was still growing, so the CLI and the UI typecheck only in
// CI (build-cli.yml, build-web.yml); local vitest runs still work.
//
// Usage, from the repository root:  node termux/typecheck-lowmem.mjs apps/cli [--max-mb 2200]
// The exit code is tsgo's; 137 means the watchdog stopped it (raise --max-mb only with free memory).
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const workspace = args.find((arg) => !arg.startsWith('--'));
const maxMbIndex = args.indexOf('--max-mb');
const maxMb = maxMbIndex >= 0 ? Number(args[maxMbIndex + 1]) : 2200;
if (!workspace || !Number.isFinite(maxMb) || maxMb <= 0) {
  console.error('usage: node termux/typecheck-lowmem.mjs <workspace dir> [--max-mb N]');
  process.exit(2);
}

const pageKb = 4;
function treeRssMb(rootPid) {
  const children = new Map();
  const rss = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      // Fields after the command name: state ppid ... rss is field 24 overall.
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const pid = Number(name);
      const ppid = Number(fields[1]);
      rss.set(pid, Number(fields[21]) * pageKb);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    } catch {
      // The process ended while we read it.
    }
  }
  let totalKb = 0;
  const stack = [rootPid];
  const seen = [];
  while (stack.length > 0) {
    const pid = stack.pop();
    seen.push(pid);
    totalKb += rss.get(pid) ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return { mb: totalKb / 1024, pids: seen };
}

const repoRoot = process.cwd();
const child = spawn(process.execPath, [join(repoRoot, 'scripts/workspaces/runTypeScriptCli.mjs'), '--noEmit', '--singleThreaded'], {
  cwd: resolve(repoRoot, workspace),
  stdio: 'inherit',
  // A lower GOGC collects more often, which keeps the peak lower at the cost of some time.
  env: { ...process.env, GOMEMLIMIT: `${Math.floor(maxMb * 0.7)}MiB`, GOGC: process.env.GOGC ?? '40' },
});

let peakMb = 0;
let stopped = false;
const startedAt = Date.now();
const timer = setInterval(() => {
  const { mb, pids } = treeRssMb(child.pid);
  peakMb = Math.max(peakMb, mb);
  if (mb > maxMb && !stopped) {
    stopped = true;
    console.error(`typecheck-lowmem: ${Math.round(mb)} MB > ${maxMb} MB; stopping the typecheck`);
    for (const pid of pids.reverse()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}, 500);

child.on('exit', (code, signal) => {
  clearInterval(timer);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.error(`typecheck-lowmem: peak ${Math.round(peakMb)} MB, ${seconds} s`);
  process.exit(stopped ? 137 : code ?? (signal ? 1 : 0));
});
