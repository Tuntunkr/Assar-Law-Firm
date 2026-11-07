#!/usr/bin/env node
// Scans files in a git repository for committed secrets. Exit code 1 if anything is found.
//
//   node scripts/check-secrets.mjs [--root <dir>] [--staged]
//
// Scans tracked files plus untracked files that are not git-ignored (so a new, not-yet-committed file is
// caught too). Findings never print the secret itself, only the file, line, rule and the first 4 characters.
//
// Suppress a line you have reviewed with a trailing `secrets:ignore` comment, or list path prefixes in
// `.secrets-allowlist` (one per line). Test fixtures should use obviously fake values instead.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
const staged = args.includes('--staged');

const RULES = [
  {
    id: 'private-key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'aws-secret-key', re: /aws_?secret_?access_?key["'\s:=]+[A-Za-z0-9/+=]{40}\b/i },
  { id: 'xai-api-key', re: /\bxai-[A-Za-z0-9]{30,}\b/ },
  { id: 'openai-or-anthropic-key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{30,}\b/ },
  { id: 'assar-service-token', re: /\bast_[A-Za-z0-9_-]{36,}\b/ },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'stripe-live-key', re: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
  {
    id: 'url-with-password',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/[^\s:@/'"`]+:[^\s@/'"`$<>{}]{3,}@/i,
  },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    id: 'hardcoded-secret-assignment',
    // secret/password/token/api key assigned a long, random-looking literal (not an env lookup or placeholder)
    re: /\b(?:secret|passw(?:or)?d|passphrase|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b["']?\s*[:=]\s*["'`](?!\$\{|<|\{\{|process\.env|your[-_ ]|change[-_ ]?me|example|placeholder|xxx|\*{3})([A-Za-z0-9+/=_-]{20,})["'`]/i,
    entropy: 3.5,
  },
];

const SKIP_FILE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|\.(?:png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|gz|enc|lock)$/i;

function entropy(s) {
  const f = new Map();
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  return -[...f.values()].reduce((sum, n) => sum + (n / s.length) * Math.log2(n / s.length), 0);
}

function listFiles() {
  const git = (...a) =>
    execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = staged
    ? git('diff', '--cached', '--name-only', '--diff-filter=ACM', '-z')
    : git('ls-files', '-z', '--cached', '--others', '--exclude-standard');
  return out.split('\0').filter(Boolean);
}

const allow = existsSync(join(root, '.secrets-allowlist'))
  ? readFileSync(join(root, '.secrets-allowlist'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];

const findings = [];
for (const file of listFiles()) {
  if (SKIP_FILE.test(file) || allow.some((p) => file === p || file.startsWith(p))) continue;
  const full = join(root, file);
  let st;
  try {
    st = statSync(full);
  } catch {
    continue;
  } // deleted but still listed
  if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;

  // A committed environment file is itself a finding, whatever it contains (the example file is the exception).
  if (/(?:^|\/)\.env(?:\.[\w.-]+)?$/.test(file) && !/\.env\.example$/.test(file)) {
    findings.push({ file, line: 0, rule: 'env-file-committed', hint: '' });
    continue;
  }

  const buf = readFileSync(full);
  if (buf.includes(0)) continue; // binary
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((text, i) => {
    if (text.includes('secrets:ignore') || text.length > 4000) return;
    for (const rule of RULES) {
      const m = rule.re.exec(text);
      if (!m) continue;
      const value = m[1] ?? m[0];
      if (rule.entropy && entropy(value) < rule.entropy) continue;
      findings.push({
        file,
        line: i + 1,
        rule: rule.id,
        hint: `${value.slice(0, 4)}…(${value.length} chars)`,
      });
      break;
    }
  });
}

if (findings.length === 0) {
  console.log('secret scan: no secrets found');
} else {
  console.error(`secret scan: ${findings.length} possible secret(s)`);
  for (const f of findings)
    console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}]  ${f.hint}`);
  console.error(
    '\nRemove the value and rotate it if it was ever real. For reviewed false positives add `secrets:ignore` to the line.',
  );
  process.exitCode = 1;
}
