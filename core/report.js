// Text report: verdict first, one block per finding, then what was not checked.
// ASCII only; Windows terminals still default to cp932 or cp1252 in places.

const CHECK_WIDTH = 16;
// Only what must be committed for the config to work counts as a defect.
const DEAD = ['files-missing', 'reference-missing', 'extends-missing'];
const OBSERVATIONS = ['include-missing', 'paths-missing', 'include-inert'];

export function renderText(result) {
  const lines = [];
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      lines.push(`This tool couldn't read ${error.file}${error.line ? ` (line ${error.line})` : ''}: ${error.message}.`);
    }
    lines.push('That is our parser, not necessarily your config.');
    return lines.join('\n');
  }

  lines.push(verdict(result));
  lines.push(`${result.summary.tsconfigs} tsconfig file${result.summary.tsconfigs === 1 ? '' : 's'} read in ${result.summary.files_scanned} files.`);

  for (const finding of result.findings.filter((item) => !OBSERVATIONS.includes(item.check))) {
    lines.push('');
    lines.push(`${finding.check.padEnd(CHECK_WIDTH)}${finding.file}:${finding.line}`);
    lines.push(`${' '.repeat(CHECK_WIDTH)}${finding.detail}`);
  }

  const observations = result.findings.filter((item) => OBSERVATIONS.includes(item.check) && item.severity !== 'info');
  if (observations.length > 0) {
    lines.push('');
    lines.push(`Also observed: ${observations.length} include/paths entr${observations.length === 1 ? 'y' : 'ies'} name paths`);
    lines.push('that may be produced by a build and are absent from every clone. Not counted above,');
    lines.push('because a build can satisfy them:');
    for (const finding of observations) {
      lines.push('');
      lines.push(`${finding.check.padEnd(CHECK_WIDTH)}${finding.file}:${finding.line}`);
      lines.push(`${' '.repeat(CHECK_WIDTH)}${finding.detail}`);
    }
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push('Not checked:');
    for (const reason of new Set(result.skipped.map((item) => item.reason))) lines.push(`  - ${reason}`);
  }
  return lines.join('\n');
}

export function verdict(result) {
  const dead = result.findings.filter((finding) => DEAD.includes(finding.check));
  if (dead.length === 0) {
    return 'Every path in your tsconfig points at something that exists. That is not proof your build is configured correctly, only that nothing is dangling.';
  }
  return `${dead.length} path${dead.length === 1 ? '' : 's'} in your tsconfig point${dead.length === 1 ? 's' : ''} at nothing.`;
}
