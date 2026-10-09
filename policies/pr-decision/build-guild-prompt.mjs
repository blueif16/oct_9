// Builds the Guild agent's PROMPT.md from the Guild adapter + the shared policy,
// so the policy text exists in one place. `--check` exits 1 if PROMPT.md has drifted.
// Usage: node policies/pr-decision/build-guild-prompt.mjs [--check] [path/to/PROMPT.md]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const args = process.argv.slice(2);
const check = args.includes('--check');
const target = args.find((a) => a !== '--check')
  ?? join(homedir(), 'Desktop/guild-pr-decision/agent/PROMPT.md');

const prompt = readFileSync(join(here, 'guild.md'), 'utf8') + readFileSync(join(here, 'POLICY.md'), 'utf8');

if (check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== prompt) {
    console.error(`${target} is out of date; run npm run policy:guild`);
    process.exit(1);
  }
  console.log(`${target} matches the policy`);
} else {
  writeFileSync(target, prompt);
  console.log(`wrote ${target}`);
}
