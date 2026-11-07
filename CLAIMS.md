# Claims

Every public claim with the command that reproduces it. Two guard rails apply to
every row: **a reference is a defect only if the artefact must be committed for
the thing to work**, and a number never comes from a regex — only from this
parser over a real sample.

| # | claim | command | expected |
|---|---|---|---|
| 1 | `files:` entries that do not exist are reported | `npm test` (fixture `files: exact missing path is reported`) | pass |
| 2 | `references[].path` that does not exist is reported | `npm test` (fixture `references: a missing path is reported`) | pass |
| 3 | a relative `extends` that does not exist is reported; a bare package specifier is skipped | `npm test` (fixture `extends: relative missing is reported`) | pass |
| 4 | `extends: "./base"` resolves the `.json` form | `npm test` (fixture `extends without an extension`) | pass |
| 5 | `include` globs and `paths` targets are observations, never defects | `npm test` (fixture `files makes include inert` / `paths: static prefix`) | `severity: observation`, `summary.findings = 0` |
| 6 | with no file list, nothing is accused | `npm test` (fixture `no repository contents: skip, never accuse`) | findings `[]`, one skip |
| 7 | generated trees are never reported | `node bin/tsconfig-resolve-check.js <repo>` on a repo with `next-env.d.ts` and `node_modules` | no finding whose subject lies in those dirs |
| 8 | measured prevalence: `files-missing` 10, `extends-missing` 0, `reference-missing` 0 | `node tools/sweep.mjs` | first two lines name the counts |
| 9 | exit codes 0 / 2 / 1 | `node bin/tsconfig-resolve-check.js <clean repo>; echo $?` | `0`; with a dead `files:` entry `2`; on unparsable JSONC `1` |
| 10 | JSONC with comments and trailing commas is accepted | `npm test` (fixture `JSONC: comments, trailing commas`) | pass |

Claims deliberately absent: any glob-matching claim, any statement about
"compiling correctly", any count for generated files. None of them has a command
that could confirm or refute it.
