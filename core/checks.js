// The five checks. Every one answers "does this path exist in this repository",
// and nothing else: no module resolution, no type checking, no glob semantics
// beyond a static prefix.
//
// Two rules keep it honest:
//   * with no file list we skip existence checks and say so (never claim a
//     file is missing without having looked);
//   * if `files` is present, TypeScript ignores `include`, so include entries are
//     informational - they cannot make a build wrong.

import { getEntry, getValue } from './jsonc.js';

const GLOB = /[*?[\]]/;

/**
 * Paths that cannot be judged from a git tree: `node_modules` is never
 * committed, and these directories are build output that only exists after a
 * build. Reporting them as missing would be technically true and practically
 * wrong, which is the failure class this tool cannot afford.
 */
const UNJUDGEABLE = [
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.nuxt',
  '.svelte-kit',
  '.vercel',
];

/** Files a toolchain generates at build time: absent from every clone and correct. */
const GENERATED_FILES = ['next-env.d.ts', '.eslintcache'];

export function isUnjudgeable(path) {
  const parts = String(path).split('/');
  const base = parts[parts.length - 1];
  if (GENERATED_FILES.includes(base)) return true;
  return parts.some((part) => UNJUDGEABLE.includes(part));
}

/**
 * @param {{tsconfigs: object[], view: {filePaths: string[]}}} input
 */
export function runChecks({ tsconfigs, view }) {
  const findings = [];
  const skipped = [];
  const files = new Set();
  const directories = new Set(['/']);
  for (const raw of view.filePaths ?? []) {
    const path = String(raw).replace(/^\//, '');
    if (path === '') continue;
    files.add(path);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) directories.add(`/${parts.slice(0, i).join('/')}`);
  }
  const hasContents = files.size > 0;
  if (!hasContents) {
    skipped.push({
      check: 'existence',
      reason: 'no repository contents were provided, so no path could be checked',
    });
    return { findings, skipped };
  }

  for (const tsconfig of tsconfigs) {
    const base = dirname(tsconfig.path);
    checkFiles(tsconfig, files, directories, findings);
    checkReferences(tsconfig, files, directories, findings);
    checkPaths(tsconfig, base, files, directories, findings);
    checkInclude(tsconfig, base, files, directories, findings);
    checkExtends(tsconfig, base, files, directories, findings);
  }
  return { findings, skipped };
}

/** `files: ["src/index.ts"]` — exact paths, highest confidence. */
function checkFiles(tsconfig, files, directories, findings) {
  const node = getValue(tsconfig.root, 'files');
  if (!node || node.type !== 'array') return;
  for (const item of node.items) {
    if (item.type !== 'string') continue;
    // TypeScript resolves "files" relative to the tsconfig that declares it.
    const target = normalize(joinPath(dirname(tsconfig.path), item.value));
    if (exists(target, files, directories)) continue;
    if (isUnjudgeable(target)) continue;
    findings.push({
      check: 'files-missing',
      file: tsconfig.path,
      line: item.line,
      subject: item.value,
      detail: `"files" lists "${item.value}", which does not exist relative to ${directoryLabel(tsconfig.path)}`,
    });
  }
}

/** `references: [{ path: "../core" }]` — exact file or directory. */
function checkReferences(tsconfig, files, directories, findings) {
  const node = getValue(tsconfig.root, 'references');
  if (!node || node.type !== 'array') return;
  for (const item of node.items) {
    if (item.type !== 'object') continue;
    const pathEntry = getEntry(item, 'path');
    if (!pathEntry || pathEntry.value.type !== 'string') continue;
    const base = dirname(tsconfig.path);
    const target = joinPath(base, pathEntry.value.value);
    if (exists(normalize(target), files, directories)) continue;
    if (isUnjudgeable(normalize(target))) continue;
    findings.push({
      check: 'reference-missing',
      file: tsconfig.path,
      line: pathEntry.value.line,
      subject: pathEntry.value.value,
      detail: `"references" points at "${pathEntry.value.value}", which resolves to /${normalize(target)} and does not exist`,
    });
  }
}

/** `compilerOptions.paths` targets: static prefix, resolved from baseUrl. */
function checkPaths(tsconfig, base, files, directories, findings) {
  const compilerOptions = getValue(tsconfig.root, 'compilerOptions');
  if (!compilerOptions || compilerOptions.type !== 'object') return;
  const pathsEntry = getEntry(compilerOptions, 'paths');
  if (!pathsEntry || pathsEntry.value.type !== 'object') return;
  const baseUrlEntry = getEntry(compilerOptions, 'baseUrl');
  const baseUrl = baseUrlEntry && baseUrlEntry.value.type === 'string' ? baseUrlEntry.value.value : '.';

  for (const alias of pathsEntry.value.entries) {
    if (alias.value.type !== 'array') continue;
    for (const target of alias.value.items) {
      if (target.type !== 'string') continue;
      const prefix = staticPrefix(target.value);
      if (prefix === '') continue;
      const resolved = joinPath(joinPath(base, baseUrl), prefix);
      if (exists(normalize(resolved), files, directories)) continue;
      if (isUnjudgeable(normalize(resolved))) continue;
      if (!exists(dirname(normalize(resolved)), files, directories)) continue;
      findings.push({
        check: 'paths-missing',
        severity: 'observation',
        file: tsconfig.path,
        line: target.line,
        subject: target.value,
        detail: `paths["${alias.key}"] maps to "${target.value}", whose static prefix resolves to /${normalize(resolved)} and does not exist`,
      });
    }
  }
}

/** `include` static prefixes: observations, never defects (a build may produce them). */
function checkInclude(tsconfig, base, files, directories, findings) {
  const node = getValue(tsconfig.root, 'include');
  if (!node || node.type !== 'array') return;
  for (const item of node.items) {
    if (item.type !== 'string') continue;
    const prefix = staticPrefix(item.value);
    if (prefix === '') continue;
    const resolved = normalize(joinPath(base, prefix));
    if (exists(resolved, files, directories)) continue;
    if (isUnjudgeable(resolved)) continue;
    if (!exists(dirname(resolved), files, directories)) continue;
    findings.push({
      check: 'include-missing',
      severity: 'observation',
      file: tsconfig.path,
      line: item.line,
      subject: item.value,
      detail: `include "${item.value}" has a static prefix (/${resolved}) that does not exist`,
    });
  }
}

/** `extends: "./base.json"` — relative only; bare package specifiers are skipped. */
function checkExtends(tsconfig, base, files, directories, findings) {
  const node = getValue(tsconfig.root, 'extends');
  if (!node) return;
  const values = node.type === 'string' ? [node] : node.type === 'array' ? node.items : [];
  for (const value of values) {
    if (value.type !== 'string') continue;
    const specifier = value.value;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    const resolved = normalize(joinPath(base, specifier));
    if (exists(resolved, files, directories) || exists(`${resolved}.json`, files, directories)) continue;
    if (isUnjudgeable(resolved)) continue;
    findings.push({
      check: 'extends-missing',
      file: tsconfig.path,
      line: value.line,
      subject: specifier,
      detail: `"extends" points at "${specifier}", which resolves to /${resolved} and does not exist`,
    });
  }
}

/**
 * Text before the first glob character, cut back to a path boundary.
 * A prefix that exists is never reported: judging the rest needs TypeScript's
 * matching rules, which this tool does not model.
 */
export function staticPrefix(value) {
  const text = String(value);
  const index = text.search(GLOB);
  const head = index < 0 ? text : text.slice(0, index);
  if (index < 0) return head.replace(/\/+$/, '');
  const slash = head.lastIndexOf('/');
  return (slash < 0 ? '' : head.slice(0, slash)).replace(/\/+$/, '');
}

function exists(path, files, directories) {
  if (path === '' || path === '.') return true;
  if (files.has(path) || directories.has(`/${path}`)) return true;
  return false;
}

export function dirname(path) {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function joinPath(base, relative) {
  const parts = `${base}/${relative}`.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) continue;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function normalize(path) {
  return joinPath('', String(path));
}

function directoryLabel(tsconfigPath) {
  const dir = dirname(tsconfigPath);
  return dir === '' ? 'the repository root' : `/${dir}`;
}
