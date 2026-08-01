# Editor core provenance

The Mint Notes live Markdown editor core was derived from
[`Yuyz0112/typora-web`](https://github.com/Yuyz0112/typora-web) at commit
`7d2ed21904cbd30923e2b905415b842b5e35b713` (the `0.3.1` release commit).

The imported source is licensed under the MIT License. The original license
is retained in `LICENSE.typora-web`, and its notice is also included in the
application's distributed third-party notices.

Mint Notes maintains this source as its in-repository ProseMirror/Markdown
core. Project-specific core changes include canonical Markdown escape
handling, delayed blockquote conversion, a generic extension contract, and a
stable controller that does not expose the underlying ProseMirror view.
Callout and Math/Mermaid/WikiLink behavior lives in sibling modules under
`src/editor/extensions/` and is injected into the core. Future changes must
preserve the canonical Markdown and editor-boundary constraints documented in
the root `AGENTS.md` and `docs/DEVELOPMENT.md`.

The upstream behavior specs and test harness are retained in `specs/` and
`upstream-tests/`, adapted only to the repository's Vitest runner and local
module paths. Mint-specific invariants have additional tests beside the core
and in `src/editor/`.
