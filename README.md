# tsconfig pointing at nothing: files and references your config lists but the repo does not have

A `tsconfig.json` can name a file or a project reference that does not exist. The
compiler then silently compiles less than you think, or fails with an error that
names the symptom and not the cause. This checks the two paths that **must be
committed for the config to work**: `files` entries and `references[].path`.

Measured on 21 public repositories (20 had tsconfigs), with this tool's parser:

| check | findings |
|---|---|
| `files-missing` | 10 |
| `extends-missing` | 0 |
| `reference-missing` | 0 |

Run it in one command:

```bash
npx --yes github:seipass/tsconfig-resolve-check#v0.1.0 .
```

Real output, run against `nestjs/nest` (153 tsconfig files):

```
1 path in your tsconfig points at nothing.
153 tsconfig files read in 2750 files.

files-missing   tools/gulp/tsconfig.json:19
                "files" lists "gulpfile.ts", which does not exist relative to /tools/gulp
```

## Also observed, and deliberately not counted

`include` globs and `compilerOptions.paths` targets are checked too, and they are
listed under their own heading with their own count. They are **not** reported as
defects, because a build can create them: `next-env.d.ts`, `.svelte-kit/`,
`.astro/types.d.ts` and `prisma/generated/**` are absent from every clone and
entirely correct. Measured in the same sample: 138 `include` and 119 `paths`
entries whose static prefix is absent. Treat them as a hint, not a verdict.

The distinguishing rule, stated so you can disagree with it: **a reference is a
defect only if the referenced artifact must be committed for the thing to work.**
`files:` and `references:` qualify — the compiler opens them. A glob that a build
satisfies does not.

## What this cannot see

- **Whether a glob matches.** For `include` and `paths` only the text before the
  first `*`, `?` or `[` is checked; if that prefix exists nothing is reported,
  even when no file matches the full pattern. Judging the rest needs TypeScript's
  matching rules, which this tool does not model.
- **Generated files.** A missing path inside `node_modules`, `.next`, `dist`,
  `build`, `out`, `coverage`, `.turbo`, `.nuxt`, `.svelte-kit` or `.vercel` is
  never reported: those directories are not in a git tree by construction.
- **Type correctness, module resolution, project-reference build graphs, extends
  chains.** Nothing is followed, evaluated or type-checked.
- **Configs with comments.** They are read as JSONC (comments and trailing commas),
  so a config TypeScript accepts is not rejected. Block scalars and JSON5 single
  quotes are not supported, and the error message says it is our parser.
- **Writing anything.** There is no write path in this package; fixes are prose.

## Exit codes and `--json`

| code | meaning |
|---|---|
| 0 | no defects (observations do not fail the run) |
| 2 | defects |
| 1 | usage error, or a tsconfig this tool cannot read |

`--json` emits `{ok, version, tsconfigs, findings: [{check, severity, file, line, subject, detail}], skipped, errors, summary: {tsconfigs, findings, observations, by_check, files_scanned}, exit}`.
Defects have `severity: "warning"`, observations `"observation"`, and the inert
`include` case (a `files` list makes `include` meaningless to the compiler) `"info"`.
`--fail-on <checks>` narrows what fails the run.

## Development

```bash
npm test                 # node --test, no dependencies
node tools/sweep.mjs     # re-measure the table (needs gh auth)
```

The claims in this README, with the command that reproduces each one, are in
`CLAIMS.md`.

## CI

`.github/workflows/ci.yml` runs the suite on `ubuntu-latest` and
`windows-latest` with Node 20 and 24.

MIT licensed.
