import { readFileSync } from "node:fs";

const tag = process.argv[2];
const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag ?? "");

if (!match) {
  console.error("Release tag must use stable SemVer syntax such as v0.4.0.");
  process.exit(1);
}

const version = tag.slice(1);
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const releaseHeading = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");

if (!releaseHeading.test(changelog)) {
  console.error(`CHANGELOG.md must contain a dated "## [${version}] - YYYY-MM-DD" heading.`);
  process.exit(1);
}

process.stdout.write(`${version}\n`);
