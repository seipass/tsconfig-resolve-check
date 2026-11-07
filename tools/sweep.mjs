#!/usr/bin/env node
// Prevalence sweep: measure with the real parser, never a regex.
// For each repo: fetch tree + every tsconfig, materialise, run the CLI.
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, 'cache');
const bin = join(here, '..', 'bin', 'tsconfig-resolve-check.js');
const refresh = process.argv.includes('--refresh');
const REPOS = [
  'nestjs/nest', 'supabase/supabase', 'calcom/cal.com', 'n8n-io/n8n', 'immich-app/immich',
  'appwrite/appwrite', 'directus/directus', 'medusajs/medusa', 'strapi/strapi',
  'excalidraw/excalidraw', 'tldraw/tldraw', 'trpc/trpc', 'documenso/documenso',
  'formbricks/formbricks', 'hoppscotch/hoppscotch', 'lobehub/lobe-chat',
  'continuedev/continue', 'cli/cli', 'payloadcms/payload', 'novuhq/novu', 'typeorm/typeorm',
];
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const HEADERS = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'tsc-sweep' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(url, attempt = 0) {
  const response = await fetch(url, { headers: HEADERS });
  if (response.status === 403 || response.status === 429) {
    if (attempt > 5) throw new Error(`rate limited ${url}`);
    await sleep(10000);
    return api(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function raw(repo, sha, path) {
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!response.ok) return null;
  return response.text();
}
async function pool(items, size, worker) {
  let index = 0;
  const out = [];
  await Promise.all(Array.from({ length: size }, async () => {
    for (;;) {
      const current = index; index += 1;
      if (current >= items.length) return;
      out[current] = await worker(items[current]);
    }
  }));
  return out;
}
const results = await pool(REPOS, 4, async (repo) => {
  const dir = join(cache, repo.replace('/', '__'));
  const meta = join(dir, '.meta.json');
  try {
    if (refresh && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    let saved = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : null;
    if (!saved) {
      const info = await api(`https://api.github.com/repos/${repo}`);
      const commit = await api(`https://api.github.com/repos/${repo}/commits/${info.default_branch}`);
      const tree = await api(`https://api.github.com/repos/${repo}/git/trees/${commit.sha}?recursive=1`);
      saved = {
        sha: commit.sha,
        truncated: Boolean(tree.truncated),
        paths: tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path),
      };
      mkdirSync(dir, { recursive: true });
      writeFileSync(meta, JSON.stringify(saved));
    }
    const configs = saved.paths.filter((p) => /(^|\/)tsconfig[^/]*\.json$/i.test(p) && !p.includes('node_modules/'));
    for (const path of configs) {
      const absolute = join(dir, path);
      if (existsSync(absolute)) continue;
      const text = await raw(repo, saved.sha, path);
      if (text == null) continue;
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, text);
    }
    writeFileSync(join(dir, '.tree.json'), JSON.stringify({ paths: saved.paths }));
    if (configs.length === 0) return { repo, configs: 0, findings: [] };
    const out = spawnSync(process.execPath, [bin, dir, '--json', '--tree', join(dir, '.tree.json'), '--fail-on', 'none'], { encoding: 'utf8', timeout: 60000 });
    const payload = JSON.parse(out.stdout);
    return { repo, configs: configs.length, findings: payload.findings, truncated: saved.truncated };
  } catch (error) {
    return { repo, error: error.message };
  }
});
const usable = results.filter((item) => item && !item.error && item.configs > 0);
const perCheck = {};
for (const item of usable) for (const f of item.findings) if (f.severity !== 'info') perCheck[f.check] = (perCheck[f.check] ?? 0) + 1;
const withFinding = usable.filter((item) => item.findings.some((f) => f.severity !== 'info'));
console.log(`repos: ${results.length}, with tsconfigs: ${usable.length}, with >=1 finding: ${withFinding.length}`);
console.log(`per check: ${JSON.stringify(perCheck)}`);
for (const item of results.filter((e) => e && e.error)) console.log(`  error ${item.repo}: ${item.error}`);
for (const item of withFinding) {
  console.log(`\n${item.repo} (${item.configs} tsconfigs)`);
  for (const f of item.findings.slice(0, 4)) console.log(`  ${f.check} ${f.file}:${f.line} ${f.subject}`);
}
writeFileSync(join(here, 'results.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2)}\n`);
