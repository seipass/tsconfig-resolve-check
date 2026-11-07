import { readFileSync, writeFileSync } from 'node:fs';
const p = new URL('../README.md', import.meta.url);
let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const start = s.indexOf('> **The first published figures');
const end = s.indexOf('Run it in one command:');
if (start < 0 || end < 0) throw new Error('anchors');
const block = `> **The published figures in \`v0.1.1\` are withdrawn.**
> A defect in that release resolved \`files\` against the repository root instead of
> the tsconfig that declares it, so every nested tsconfig with a \`files\` list
> produced a false finding: the published "10 findings" were all false positives,
> and four of them were checked against the live repositories by hand. \`files\` and
> \`extends\` resolve relative to their tsconfig, as they always should have; the
> fix is in \`0.1.2\` and adds generated-path exemptions for \`files\` and removes an
> \`include-inert\` observation that \`tsc --listFiles\` refutes.
>
> No table is claimed here. The re-run of the same 21-repository sample, after the
> fix (\`node tools/sweep.mjs\`), found **no defects in the 20 repositories that have
> a tsconfig**. That is a weaker product than the invented one and it is the true
> one: a tsconfig that names a missing file is a config someone has already fixed.

`;
s = s.slice(0, start) + block + s.slice(end);
writeFileSync(p, s);
console.log('readme');
