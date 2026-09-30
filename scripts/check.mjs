import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
async function walk(directory) { const files = []; for (const item of await readdir(directory, { withFileTypes: true })) { const path = resolve(directory, item.name); if (item.isDirectory()) files.push(...await walk(path)); else files.push(path); } return files; }
for (const folder of ['assets/js', 'js', 'scripts', 'tests']) for (const file of await walk(resolve(root, folder))) {
  if (!/\.(mjs|js)$/.test(file)) continue;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
}
for (const folder of ['assets/js', 'reservar', 'admin']) for (const file of await walk(resolve(root, folder))) {
  const source = await readFile(file, 'utf8');
  if (/innerHTML\s*=|insertAdjacentHTML|SUPABASE_SERVICE_ROLE_KEY\s*[:=]|GOOGLE_CALENDAR_CLIENT_SECRET\s*[:=]/.test(source)) throw new Error(`Unsafe public code: ${file}`);
}
console.log('JavaScript syntax and public-code checks passed.');
