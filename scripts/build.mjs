import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'public');
// Refuse to delete a preexisting directory that this build did not create.
try {
  await readdir(output);
  if ((await readFile(resolve(output, '.static-build'), 'utf8')) !== 'castellanos-static\n') throw new Error('Unknown build directory');
  await rm(output, { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(output, { recursive: true });
await writeFile(resolve(output, '.static-build'), 'castellanos-static\n');
const extensions = new Set(['.html', '.css', '.js', '.jpg', '.jpeg', '.webp', '.png', '.svg', '.ico', '.woff', '.woff2']);
for (const folder of ['assets', 'css', 'js']) {
  await cp(resolve(root, folder), resolve(output, folder), {
    recursive: true, filter: async source => {
      const { lstat } = await import('node:fs/promises'); const info = await lstat(source);
      if (info.isSymbolicLink()) throw new Error('Symlinks are not allowed in the static artifact');
      return info.isDirectory() || extensions.has(extname(source));
    },
  });
}
for (const file of ['index.html', '404.html', 'robots.txt', 'sitemap.xml']) await cp(resolve(root, file), resolve(output, file));
console.log('Static portfolio built in public/.');
