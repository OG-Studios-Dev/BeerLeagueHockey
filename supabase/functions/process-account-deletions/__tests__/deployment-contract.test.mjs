import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const functionDirectory = path.resolve(
  process.cwd(),
  'supabase/functions/process-account-deletions',
);

test('production loader applies the exact target filter and selection-specific limit', () => {
  const source = fs.readFileSync(path.join(functionDirectory, 'index.ts'), 'utf8');
  assert.match(source, /if \(selection\.mode === 'target'\) \{\s*query = query\.eq\('user_id', selection\.userId\);\s*\}/s);
  assert.match(source, /return await query\.limit\(selection\.limit\);/);
  assert.doesNotMatch(source, /\.limit\(50\)/);
});

test('function config preserves delete-account JWT verification and matches deployed processor policy', () => {
  const config = fs.readFileSync(path.resolve(process.cwd(), 'supabase/config.toml'), 'utf8');
  assert.match(config, /\[functions\.delete-account\]\s+enabled = true\s+verify_jwt = true/s);
  assert.match(config, /\[functions\.process-account-deletions\]\s+enabled = true\s+verify_jwt = false/s);
});

test('production entrypoint prefers the dedicated deletion scheduler secret and retains the generic fallback', () => {
  const source = fs.readFileSync(path.join(functionDirectory, 'index.ts'), 'utf8');
  assert.match(
    source,
    /cronSecret:\s*Deno\.env\.get\('ACCOUNT_DELETION_CRON_SECRET'\)\s*\?\?\s*Deno\.env\.get\('CRON_SECRET'\)/,
  );
});
