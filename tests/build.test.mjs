import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
test('static artifact contains real routes and excludes backend, docs, tests and secrets', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  const files = await readdir(resolve(root, 'public'));
  for (const forbidden of ['supabase', 'docs', 'tests', '.env', '.env.example', '.git', 'package.json']) assert.ok(!files.includes(forbidden));
  for (const file of ['index.html', 'reservar/index.html', 'reservar/privacidad.html', 'admin/index.html']) assert.ok((await readFile(resolve(root, 'public', file), 'utf8')).includes('<!doctype html>'));
  assert.match(await readFile(resolve(root, 'public/admin/index.html'), 'utf8'), /noindex,nofollow/);
});
