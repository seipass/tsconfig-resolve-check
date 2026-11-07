# tsconfig pointing at nothing: files and references your config lists but the repo does not have

A `tsconfig.json` can name a file or a project reference that does not exist. The
compiler then silently compiles less than you think, or fails with an error that
names the symptom and not the cause. This checks the two paths that **must be
committed for the config to work**: `files` entries and `references[].path`.

> **The published figures in `v0.1.1` are withdrawn.**
> A defect in that release resolved `files` against the repository root instead of
> the tsconfig that declares it, so every nested tsconfig with a `files` list
> produced a false finding: the published "10 findings" were all false positives,
> and four of them were checked against the live repositories by hand. `files` and
> `extends` resolve relative to their tsconfig, as they always should have; the fix
> is in `0.1.2`, which also applies the generated-path exemption to `files` and
> removes an `include-inert` observation that `tsc --listFiles` refutes.
>
> No table is claimed here. The re-run of the same 21-repository sample after the
> fix (`node tools/sweep.mjs`) found **no defects in the 20 repositories that have
> a tsconfig**. That is a weaker product than the invented one and it is the true
> one: a tsconfig that names a missing file is a config someone has already fixed.

Run it in one command:

```bash
npx --yes github:seipass/tsconfig-resolve-check#v0.1.1 .
```

## What this deliberately does not check

`include` globs and `compilerOptions.paths` targets are read but never reported:
a build may produce the files they name (`next-env.d.ts`, `.astro/types.d.ts`,
`prisma/generated/**` are absent from every clone and correct), so a miss is not a
defect. A check that fails that test is not a feature with a caveat.

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
  so a config TypeScript accepts is not rejected. JSON5 single quotes are not
  supported, and the error message says it is our parser.
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
