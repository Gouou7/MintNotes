import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareTyporaWeb, applyStrictPatch } from './prepare-typora-web.mjs';
const roots = [];
const sourcePath = 'src/editor/typora-web';
const patchesPath = 'src/editor/patches';
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fresh() {
  const root = mkdtempSync(resolve(tmpdir(), 'mint-prepare-')); roots.push(root);
  mkdirSync(resolve(root, 'src/editor'), { recursive: true });
  cpSync(sourcePath, resolve(root, sourcePath), { recursive: true }); cpSync(patchesPath, resolve(root, patchesPath), { recursive: true }); return root;
}
it('prepares a clean checkout offline and regenerates changed generated files', () => {
  const rootDirectory = fresh(); const result = prepareTyporaWeb({ rootDirectory });
  expect(result.patches).toBeGreaterThan(10); const generated = resolve(rootDirectory, '.generated/typora-web/src/mint/editor.ts');
  expect(existsSync(generated)).toBe(true); const original = readFileSync(generated, 'utf8'); writeFileSync(generated, 'modified');
  prepareTyporaWeb({ rootDirectory }); expect(readFileSync(generated, 'utf8')).toBe(original);
});
it('rejects a modified baseline before creating generated code', () => {
  const rootDirectory = fresh(); writeFileSync(resolve(rootDirectory, sourcePath, 'LICENSE'), 'changed');
  expect(() => prepareTyporaWeb({ rootDirectory })).toThrow('Original upstream file changed: LICENSE');
  expect(existsSync(resolve(rootDirectory, '.generated'))).toBe(false);
});
it('fails on a patch context mismatch without fuzzy matching', () => {
  const files = new Map([['src/file.ts', 'a\nb\nc\n']]);
  expect(() => applyStrictPatch(files, '--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,1 +1,1 @@\n-b\n+new\n', 'feature')).toThrow('feature: context mismatch');
  expect(files.get('src/file.ts')).toBe('a\nb\nc\n');
});
it('rejects mismatched commits and unsafe additions', () => {
  const rootDirectory = fresh(), path = resolve(rootDirectory, patchesPath, 'series.json'); const series = JSON.parse(readFileSync(path, 'utf8'));
  series.commit = 'different'; writeFileSync(path, JSON.stringify(series)); expect(() => prepareTyporaWeb({ rootDirectory })).toThrow('baseline');
  series.commit = '317fdb0f89a38cfc98a0bba753deec979c6722e6'; series.patches = [{ id: 'unsafe', additions: { '../outside.ts': 'integration/context.ts' } }]; writeFileSync(path, JSON.stringify(series));
  expect(() => prepareTyporaWeb({ rootDirectory })).toThrow('Unsafe upstream path');
});
