import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = value => createHash("sha256").update(value).digest("hex");
function safePath(base, path) {
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Unsafe upstream path: ${path}`);
  return target;
}

/** Apply unified diffs at their declared offsets, with no fuzzy matching. */
export function applyStrictPatch(files, patch, name) {
  const lines = patch.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "" && i === lines.length - 1) break;
    if (!lines[i].startsWith("--- a/")) throw new Error(`${name}: invalid patch header`);
    const path = lines[i++].slice(6);
    if (lines[i++] !== `+++ b/${path}`) throw new Error(`${name}: invalid file header`);
    if (!files.has(path)) throw new Error(`${name}: missing file ${path}`);
    const original = files.get(path).split("\n");
    const output = [];
    let cursor = 0;
    while (i < lines.length && lines[i].startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i++]);
      if (!match) throw new Error(`${name}: invalid hunk`);
      const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
      const start = Number(match[1]) - (oldCount ? 1 : 0);
      if (start < cursor || start > original.length) throw new Error(`${name}: invalid hunk offset`);
      output.push(...original.slice(cursor, start)); cursor = start;
      if (Number(match[3]) - (newCount ? 1 : 0) !== output.length) throw new Error(`${name}: invalid destination offset`);
      let removed = 0, added = 0;
      while (i < lines.length && (removed < oldCount || added < newCount)) {
        const line = lines[i++], kind = line[0], value = line.slice(1);
        if (kind !== "+" && kind !== "-" && kind !== " ") throw new Error(`${name}: invalid hunk body`);
        if (kind !== "+") {
          if (original[cursor++] !== value) throw new Error(`${name}: context mismatch in ${path}:${cursor}`);
          removed++;
        }
        if (kind !== "-") { output.push(value); added++; }
      }
      if (removed !== oldCount || added !== newCount) throw new Error(`${name}: invalid hunk lengths`);
    }
    output.push(...original.slice(cursor));
    files.set(path, output.join("\n"));
  }
}

export function prepareTyporaWeb({ write = true, rootDirectory = root } = {}) {
  const root = rootDirectory;
  const source = resolve(root, "src/editor/typora-web"), patches = resolve(root, "src/editor/typora-web-patches");
  const manifest = JSON.parse(readFileSync(resolve(source, "upstream.json"), "utf8"));
  const series = JSON.parse(readFileSync(resolve(patches, "series.json"), "utf8"));
  if (series.commit !== manifest.commit) throw new Error("Typora-web patch baseline does not match upstream commit");
  const listed = new Set(Object.keys(manifest.files));
  const inspect = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) inspect(resolve(directory, entry.name), path + "/");
      else if (!entry.isFile() || path !== "upstream.json" && !listed.has(path)) throw new Error(`Untracked upstream file: ${path}`);
    }
  };
  inspect(source);
  const files = new Map();
  for (const [path, hash] of Object.entries(manifest.files)) {
    const value = readFileSync(safePath(source, path));
    if (sha(value) !== hash) throw new Error(`Original upstream file changed: ${path}`);
    files.set(path, value.toString("utf8"));
  }
  const applied = new Set();
  for (const entry of series.patches) {
    if (applied.has(entry.id)) throw new Error(`Duplicate patch: ${entry.id}`);
    for (const requirement of entry.requires ?? []) {
      if (/^\d+-/.test(requirement) && !applied.has(requirement)) throw new Error(`${entry.id}: required patch ${requirement} has not been applied`);
    }
    if (entry.patch) applyStrictPatch(files, readFileSync(safePath(patches, entry.patch), "utf8"), entry.id);
    for (const [target, addition] of Object.entries(entry.additions ?? {})) {
      safePath(source, target);
      if (files.has(target)) throw new Error(`${entry.id}: addition replaces existing file ${target}`);
      files.set(target, readFileSync(safePath(patches, addition), "utf8"));
    }
    applied.add(entry.id);
  }
  const hashes = Object.fromEntries([...files].map(([path, value]) => [path, sha(value)]));
  const fingerprint = sha(JSON.stringify(hashes));
  const destination = resolve(root, ".generated/typora-web");
  const stamp = resolve(destination, "prepared.json");
  if (write) {
    const unchanged = existsSync(stamp) && JSON.parse(readFileSync(stamp, "utf8")).fingerprint === fingerprint
      && [...files].every(([path]) => existsSync(safePath(destination, path)) && sha(readFileSync(safePath(destination, path))) === hashes[path]);
    if (!unchanged) {
      rmSync(destination, { recursive: true, force: true });
      for (const [path, value] of files) { const target = safePath(destination, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value); }
      writeFileSync(stamp, JSON.stringify({ commit: manifest.commit, fingerprint, files: hashes }, null, 2) + "\n");
    }
  }
  return { commit: manifest.commit, files: files.size, patches: series.patches.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(prepareTyporaWeb({ write: !process.argv.includes("--check") }))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
