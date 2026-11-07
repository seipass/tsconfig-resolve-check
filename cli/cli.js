// CLI: filesystem + argv + exit codes. All judgement lives in core/.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { analyze, tsconfigPaths, VERSION } from '../core/analyze.js';
import { renderText } from '../core/report.js';

const USAGE = `tsconfig-resolve-check ${VERSION}
Find tsconfig paths that point at nothing: files, references, paths targets,
include prefixes and relative extends.

Usage
  tsconfig-resolve-check [path] [options]

  path                 repository to inspect (default: current directory)

Options
  --json               machine-readable output
  --tree <file>        authoritative file list (JSON {paths:[...]} or one path
                       per line) when the checkout holds only part of the repo
  --fail-on <checks>   comma-separated check names that fail the run (default: all)
  --version            print the version
  --help               print this help

Exit codes
  0  nothing dangling
  2  findings
  1  usage error, or a tsconfig this tool cannot read

Checks
  files-missing      "files" lists a path that does not exist
  reference-missing  "references[].path" does not exist
  paths-missing      a "paths" target's static prefix does not exist
  include-missing    an "include" entry's static prefix does not exist
  extends-missing    a relative "extends" does not exist
  include-inert      info only: "include" has a dead prefix, but "files" makes it inert
`;

export function main(argv = process.argv.slice(2)) {
  const options = { path: '.', json: false, failOn: 'all', tree: null };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (arg === '--version' || arg === '-v') {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--tree') {
      options.tree = argv[i + 1];
      i += 1;
      if (!options.tree) {
        process.stderr.write('error: --tree needs a file path\n');
        return 1;
      }
      continue;
    }
    if (arg.startsWith('--tree=')) {
      options.tree = arg.slice('--tree='.length);
      continue;
    }
    if (arg === '--fail-on') {
      options.failOn = argv[i + 1] ?? 'all';
      i += 1;
      continue;
    }
    if (arg.startsWith('--fail-on=')) {
      options.failOn = arg.slice('--fail-on='.length);
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      process.stderr.write(`error: unknown option ${arg}\nTry --help.\n`);
      return 1;
    }
    positional.push(arg);
  }

  const root = resolve(positional[0] ?? '.');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`error: not a directory: ${root}\n`);
    return 1;
  }

  let filePaths = walk(root).sort();
  if (options.tree) {
    try {
      filePaths = readTreeFile(options.tree);
    } catch (error) {
      process.stderr.write(`error: cannot read --tree ${options.tree}: ${error.message}\n`);
      return 1;
    }
  }

  const view = {
    root,
    filePaths,
    read(relativePath) {
      try {
        return readFileSync(join(root, ...relativePath.split('/')), 'utf8');
      } catch {
        return null;
      }
    },
  };

  const configs = [];
  for (const path of tsconfigPaths(filePaths)) {
    const text = view.read(path);
    if (text == null) continue;
    configs.push({ path, text });
  }
  if (configs.length === 0) {
    process.stderr.write(`error: no tsconfig*.json found under ${root}\n`);
    return 1;
  }

  const result = analyze({ configs, view });
  if (options.json) {
    const payload = { ...result, exit: exitCodeFor(result, options.failOn) };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload.exit;
  }
  process.stdout.write(`${renderText(result)}\n`);
  return exitCodeFor(result, options.failOn);
}

export function exitCodeFor(result, failOn = 'all') {
  if (!result.ok) return 1;
  const list = String(failOn).split(',').map((value) => value.trim()).filter(Boolean);
  if (list.includes('none')) return 0;
  const matched = result.findings.filter(
    (finding) => !['info', 'observation'].includes(finding.severity) && (list.includes('all') || list.includes(finding.check)),
  );
  return matched.length > 0 ? 2 : 0;
}

function readTreeFile(file) {
  const text = readFileSync(file, 'utf8').trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    const data = JSON.parse(text);
    const paths = Array.isArray(data) ? data : data.paths ?? data.tree ?? data.files;
    if (!Array.isArray(paths)) throw new Error('no paths array');
    return paths.map((path) => String(path).replace(/^\//, '')).filter(Boolean).sort();
  }
  return text.split(/\r?\n/).map((line) => line.trim().replace(/^\//, '')).filter(Boolean).sort();
}

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo']);

function walk(directory, base = directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      walk(join(directory, entry.name), base, out);
    } else if (entry.isFile()) {
      out.push(relative(base, join(directory, entry.name)).split(sep).join('/'));
    }
  }
  return out;
}
