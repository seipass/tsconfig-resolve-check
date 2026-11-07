import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../core/analyze.js';
import { parseJsonc, getValue, toPlain } from '../core/jsonc.js';
import { staticPrefix } from '../core/checks.js';

function viewOf(files) {
  return { root: '.', filePaths: Object.keys(files).map((path) => path.replace(/^\//, '')) };
}

function run(configText, files, path = 'tsconfig.json') {
  return analyze({ configs: [{ path, text: configText }], view: viewOf(files) });
}

test('JSONC: comments, trailing commas and line numbers', () => {
  const text = `{
  // a comment
  "compilerOptions": {
    "strict": true, /* block */
  },
  "include": ["src"],
}`;
  const root = parseJsonc(text);
  assert.deepEqual(toPlain(getValue(root, 'compilerOptions')), { strict: true });
  assert.deepEqual(toPlain(getValue(root, 'include')), ['src']);
});

test('JSONC: malformed input is an error with a line, not a finding', () => {
  const result = run('{ "include": ["src" ', { 'tsconfig.json': '', 'src/index.ts': '' });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].kind, 'parser');
  assert.ok(result.findings.length === 0);
});

test('static prefix stops at the first glob character and a path boundary', () => {
  assert.equal(staticPrefix('src/**/*.ts'), 'src');
  assert.equal(staticPrefix('src'), 'src');
  assert.equal(staticPrefix('**/*.ts'), '');
  assert.equal(staticPrefix('./lib/*.ts'), './lib');
  assert.equal(staticPrefix('@/*'), '@');
});

test('files: exact missing path is reported, present path is not', () => {
  const result = run(
    JSON.stringify({ files: ['src/index.ts', 'src/gone.ts'] }),
    { 'tsconfig.json': '', 'src/index.ts': '' },
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].check, 'files-missing');
  assert.equal(result.findings[0].subject, 'src/gone.ts');
  assert.equal(result.findings[0].line, 1);
});

test('references: a missing path is reported, a present directory is not', () => {
  const result = run(
    JSON.stringify({ references: [{ path: './packages/core' }, { path: './packages/gone' }] }),
    { 'tsconfig.json': '', 'packages/core/tsconfig.json': '' },
  );
  assert.deepEqual(result.findings.map((finding) => finding.subject), ['./packages/gone']);
});

test('paths: static prefix is resolved from baseUrl; dead alias reported, live one not', () => {
  const result = run(
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'], '#gone/*': ['./nope/*'] } } }),
    { 'tsconfig.json': '', 'src/app.ts': '' },
  );
  assert.deepEqual(result.findings, []);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].check, 'paths-missing');
});

test('include: dead prefix reported when there is no files list', () => {
  const result = run(JSON.stringify({ include: ['src', 'missing/**/*.ts'] }), { 'tsconfig.json': '', 'src/a.ts': '' });
  assert.deepEqual(result.findings, []);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].check, 'include-missing');
});

test('files and include are a union: neither is reported inert', () => {
  const result = run(
    JSON.stringify({ files: ['src/index.ts'], include: ['missing/**/*.ts'] }),
    { 'tsconfig.json': '', 'src/index.ts': '' },
  );
  assert.deepEqual(result.findings, [], 'a dead include is an observation, never a defect');
  assert.equal(result.findings.some((finding) => finding.check === 'include-inert'), false);
});

test('extends: relative missing is reported, bare specifiers and present files are not', () => {
  const result = run(
    JSON.stringify({ extends: ['./base.json', './gone.json', '@tsconfig/strictest/tsconfig.json'] }),
    { 'tsconfig.json': '', 'base.json': '{}' },
  );
  assert.deepEqual(result.findings.map((finding) => finding.check), ['extends-missing']);
  assert.equal(result.findings[0].subject, './gone.json');
});

test('extends without an extension resolves the .json form', () => {
  const result = run(JSON.stringify({ extends: './base' }), { 'tsconfig.json': '', 'base.json': '{}' });
  assert.deepEqual(result.findings, []);
});

test('no repository contents: skip, never accuse', () => {
  const result = analyze({
    configs: [{ path: 'tsconfig.json', text: JSON.stringify({ include: ['src'] }) }],
    view: { root: '.', filePaths: [] },
  });
  assert.deepEqual(result.findings, []);
  assert.ok(result.skipped.some((item) => item.check === 'existence'));
});

test('a clean config produces no findings', () => {
  const result = run(
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } }, include: ['src/**/*.ts'] }),
    { 'tsconfig.json': '', 'src/index.ts': '' },
  );
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
});

test('files resolve beside their tsconfig, not at the repository root', () => {
  const result = analyze({
    configs: [{ path: 'packages/app/tsconfig.json', text: JSON.stringify({ files: ['src/main.ts'] }) }],
    view: { root: '.', filePaths: ['packages/app/src/main.ts'] },
  });
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings));
});

test('files in a nested tsconfig still reports a genuinely missing file', () => {
  const result = analyze({
    configs: [{ path: 'packages/app/tsconfig.json', text: JSON.stringify({ files: ['src/gone.ts'] }) }],
    view: { root: '.', filePaths: ['packages/app/src/main.ts'] },
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].subject, 'src/gone.ts');
});

test('a generated next-env.d.ts is not a defect (it is in every Next.js clone)', () => {
  const result = analyze({
    configs: [{ path: 'apps/web/tsconfig.json', text: JSON.stringify({ files: ['next-env.d.ts'] }) }],
    view: { root: '.', filePaths: ['apps/web/package.json'] },
  });
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings));
});
