// Orchestration: tsconfig texts + a repo view -> findings.
//
// Pure and synchronous: the CLI supplies a node:fs view, the page supplies a
// view built from raw.githubusercontent.com + one git/trees call, tests supply
// an in-memory map. Nothing in core/ imports a Node builtin.

import { parseJsonc, JsoncError } from './jsonc.js';
import { runChecks } from './checks.js';

export const VERSION = '0.1.0';

const TSCONFIG = /(^|\/)tsconfig[^/]*\.json$/i;

/**
 * @param {{
 *   configs: {path: string, text: string}[],
 *   view: {root?: string, filePaths: string[], read?: (path: string) => string | null}
 * }} input
 */
export function analyze({ configs, view }) {
  const tsconfigs = [];
  const errors = [];
  for (const config of configs) {
    try {
      tsconfigs.push({ path: config.path, root: parseJsonc(config.text) });
    } catch (error) {
      errors.push({
        file: config.path,
        line: error instanceof JsoncError ? error.line : null,
        message: error instanceof JsoncError || error instanceof Error ? error.message : String(error),
        kind: 'parser',
      });
    }
  }

  const { findings, skipped } = runChecks({ tsconfigs, view });
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const defects = findings.filter((finding) => !['info', 'observation'].includes(finding.severity));
  const observations = findings.filter((finding) => finding.severity === 'observation');
  const byCheck = {};
  for (const finding of defects) byCheck[finding.check] = (byCheck[finding.check] ?? 0) + 1;

  return {
    ok: errors.length === 0,
    version: VERSION,
    root: view.root ?? '.',
    tsconfigs: tsconfigs.map((config) => ({ path: config.path })),
    findings: defects,
    observations,
    skipped,
    errors,
    summary: {
      tsconfigs: configs.length,
      tsconfigs_parsed: tsconfigs.length,
      // A defect is something that must be committed for the config to work.
      findings: defects.length,
      observations: observations.length,
      by_check: byCheck,
      files_scanned: (view.filePaths ?? []).length,
    },
  };
}

/** Every tsconfig among a file list (exported for the CLI and the page). */
export function tsconfigPaths(filePaths) {
  return (filePaths ?? []).map((path) => String(path).replace(/^\//, '')).filter((path) => TSCONFIG.test(path) && !path.includes('node_modules/'));
}
