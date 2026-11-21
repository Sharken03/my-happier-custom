#!/usr/bin/env node
// Plan a cold typecheck as a series of growing programs ("steps") that share one
// incremental .tsbuildinfo, so no single step needs more memory than the cap of
// scripts/typecheck-local.sh.
//
// Usage: node tools/typecheck-local/steps.mjs <projectDir> <outDir> <stepMB>
//
// Why this works: in incremental mode the compiler keeps the diagnostics of every
// checked file in the .tsbuildinfo, also when the next program has more root files.
// A step then checks only the files that no earlier step checked. The cost of a
// full check is mostly the checker state for all files at once (about 1.2 GB for
// apps/cli and 2.2 GB for apps/ui), so a step that adds at most <stepMB> MB of new
// source stays small.
//
// Step order: the import graph is split into strongly connected components (import
// cycles) in dependency order, and the components are packed into steps of at most
// <stepMB> MB of new source. A step holds all files of the earlier steps. The graph
// is an estimate from a regex scan of import specifiers; a wrong edge changes only
// the step sizes, not the result. The last step is always the full root file list
// of the real tsconfig, so its diagnostics are the diagnostics of a full check.
//
// The root file list comes from `--showConfig` (no parsing). Every step also holds
// the files that change the global scope (*.d.ts, `declare global`, `declare module`).
// Each step is a tsconfig that extends the real one. The script prints one step
// config path per line.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [projectDirArg, outDirArg, stepMbArg] = process.argv.slice(2);
if (!projectDirArg || !outDirArg) {
  console.error('usage: steps.mjs <projectDir> <outDir> [stepMB]');
  process.exit(64);
}
const projectDir = resolve(projectDirArg);
const outDir = resolve(outDirArg);
const stepBytes = Number(stepMbArg || 6) * 1024 * 1024;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tsconfigPath = join(projectDir, 'tsconfig.json');

const shown = spawnSync(process.execPath, [join(repoRoot, 'scripts/workspaces/runTypeScriptCli.mjs'), '-p', 'tsconfig.json', '--showConfig'], {
  cwd: projectDir,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (shown.status !== 0) {
  console.error(shown.stdout, shown.stderr);
  process.exit(shown.status ?? 1);
}
const shownConfig = JSON.parse(shown.stdout);
const files = shownConfig.files.map((f) => resolve(projectDir, f));

// A step config lives outside the project, so the default typeRoots (every
// node_modules/@types from the project folder up) must be set explicitly.
const compilerOptions = {};
if (!shownConfig.compilerOptions?.typeRoots) {
  compilerOptions.typeRoots = [];
  for (let d = projectDir; ; d = dirname(d)) {
    const candidate = join(d, 'node_modules/@types');
    if (existsSync(candidate)) compilerOptions.typeRoots.push(candidate);
    if (dirname(d) === d) break;
  }
}

// Wildcard path aliases such as "@/*": ["./sources/*"].
const aliases = Object.entries(shownConfig.compilerOptions?.paths ?? {})
  .filter(([key, targets]) => key.endsWith('/*') && targets[0]?.endsWith('/*'))
  .map(([key, targets]) => [key.slice(0, -1), resolve(projectDir, targets[0].slice(0, -1))]);

const text = new Map();
const read = (f) => {
  if (!text.has(f)) text.set(f, readFileSync(f, 'utf8'));
  return text.get(f);
};
const size = (f) => statSync(f).size;
const suffixes = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];
function resolveImport(from, spec) {
  let base = null;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  for (const [prefix, target] of aliases) {
    if (spec.startsWith(prefix)) base = join(target, spec.slice(prefix.length));
  }
  if (!base) return null;
  base = base.replace(/\.[cm]?js$/, '');
  for (const s of suffixes) {
    const candidate = base + s;
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}
const importPattern = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*|mock\(\s*)['"]([^'"]+)['"]/g;
const edges = new Map();
function deps(f) {
  if (!edges.has(f)) {
    const out = new Set();
    for (const m of read(f).matchAll(importPattern)) {
      const r = resolveImport(f, m[1]);
      if (r) out.add(r);
    }
    edges.set(f, [...out]);
  }
  return edges.get(f);
}

const ambientPattern = /^\s*declare\s+(global|module)\b/m;
const ambient = files.filter((f) => f.endsWith('.d.ts') || ambientPattern.test(read(f)));

// Tarjan's algorithm, iterative. Components come out in dependency order.
const index = new Map();
const low = new Map();
const onStack = new Set();
const stack = [];
const components = [];
let counter = 0;
const visit = (v) => {
  index.set(v, counter);
  low.set(v, counter);
  counter += 1;
  stack.push(v);
  onStack.add(v);
};
for (const root of files) {
  if (index.has(root)) continue;
  visit(root);
  const work = [[root, 0]];
  while (work.length > 0) {
    const top = work[work.length - 1];
    const [node, i] = top;
    const ds = deps(node);
    if (i < ds.length) {
      top[1] += 1;
      const w = ds[i];
      if (!index.has(w)) {
        visit(w);
        work.push([w, 0]);
      } else if (onStack.has(w)) {
        low.set(node, Math.min(low.get(node), index.get(w)));
      }
      continue;
    }
    work.pop();
    if (work.length > 0) {
      const parent = work[work.length - 1][0];
      low.set(parent, Math.min(low.get(parent), low.get(node)));
    }
    if (low.get(node) === index.get(node)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== node);
      components.push(component);
    }
  }
}

const rootSet = new Set(files);
const steps = [];
let done = [];
let pending = [];
let pendingBytes = 0;
for (const component of components) {
  const roots = component.filter((f) => rootSet.has(f));
  const bytes = component.reduce((s, f) => s + size(f), 0);
  if (pending.length > 0 && pendingBytes + bytes > stepBytes) {
    done = done.concat(pending);
    steps.push(done);
    pending = [];
    pendingBytes = 0;
  }
  pending.push(...roots);
  pendingBytes += bytes;
}
// The last step is the full root list, in the order of the real tsconfig.
steps.push(files);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const ambientSet = new Set(ambient);
steps.forEach((step, i) => {
  const path = join(outDir, `step-${String(i + 1).padStart(2, '0')}.json`);
  const list = i === steps.length - 1 ? step : [...ambient, ...step.filter((f) => !ambientSet.has(f))];
  writeFileSync(path, JSON.stringify({ extends: tsconfigPath, compilerOptions, include: [], files: list }));
  console.log(path);
});
