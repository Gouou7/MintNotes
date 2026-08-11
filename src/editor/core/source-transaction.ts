import type { Fragment } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "prosemirror-transform";

import { fencedCodeStructureSignature } from "./fenced-code-source";
import type { SourceTransaction } from "./source";
import { SourcePositionMap } from "./source-position-map";

export const SOURCE_TRANSACTION_META = "canonical-source-transaction";

export type TransactionSourceEffect =
  | {
      readonly kind: "source";
      readonly transaction: SourceTransaction;
      readonly reparseDerivedDocument?: boolean;
    }
  | { readonly kind: "presentation" }
  | { readonly kind: "unsupported" };

function quoteStructureSignature(source: string): string {
  return source
    .split(/\r\n|\r|\n/)
    .map((line) => /^(?: {0,3}>[\t ]?)+/.test(line) ? "quote" : "plain")
    .join("|");
}

function inlineFragmentSource(fragment: Fragment): string | null {
  let source = "";
  let supported = true;
  fragment.forEach((node) => {
    if (node.isText) {
      source += node.text ?? "";
      return;
    }
    if (node.type.name === "hard_break") {
      source += `  ${String(node.attrs.eol ?? "\n")}`;
      return;
    }
    if (node.type.name === "source_gap_eol") {
      const character = node.attrs.character;
      if (character !== "\r" && character !== "\n") supported = false;
      else source += character;
      return;
    }
    // ReplaceStep slices produced by ordinary text input may retain an open
    // inline container. It is safe only when every descendant is inline.
    if (!node.isBlock && node.childCount > 0) {
      const nested = inlineFragmentSource(node.content);
      if (nested === null) supported = false;
      else source += nested;
      return;
    }
    supported = false;
  });
  return supported ? source : null;
}

export function transactionSourceEffect(
  transaction: Transaction,
  canonicalSource: string,
): TransactionSourceEffect {
  const explicit = transaction.getMeta(SOURCE_TRANSACTION_META) as SourceTransaction | undefined;
  if (explicit) return {
    kind: "source",
    transaction: explicit,
    ...(explicit.reparseDerivedDocument ? { reparseDerivedDocument: true } : {}),
  };
  if (transaction.steps.every((step) => step instanceof AddMarkStep || step instanceof RemoveMarkStep)) {
    return { kind: "presentation" };
  }
  if (transaction.steps.length !== 1) return { kind: "unsupported" };
  const step = transaction.steps[0];
  if (!(step instanceof ReplaceStep)) return { kind: "unsupported" };

  const before = transaction.docs[0];
  if (!before) return { kind: "unsupported" };
  const editedParent = before.resolve(Math.min(step.from, before.content.size)).parent;
  let reparseDerivedDocument = false;
  if (editedParent.type.name === "blockquote" || editedParent.type.name === "code_block") {
    const mappedPosition = step.getMap().map(step.from, -1);
    const afterParent = transaction.doc.resolve(
      Math.min(mappedPosition, transaction.doc.content.size),
    ).parent;
    if (afterParent.type.name !== editedParent.type.name) {
      reparseDerivedDocument = true;
    } else if (editedParent.type.name === "blockquote") {
      reparseDerivedDocument = quoteStructureSignature(editedParent.textContent)
        !== quoteStructureSignature(afterParent.textContent);
    } else {
      reparseDerivedDocument = fencedCodeStructureSignature(editedParent.textContent)
        !== fencedCodeStructureSignature(afterParent.textContent);
    }
  }
  if (editedParent.type.name === "source_gap") {
    // Any edit in source-backed whitespace can create or remove a Markdown
    // block boundary. Reparse immediately so typed text becomes an ordinary
    // paragraph instead of remaining inside a whitespace presentation node.
    reparseDerivedDocument = true;
  }
  const positions = SourcePositionMap.fromDocument(before, canonicalSource);
  const from = positions.documentToSource(step.from, "right");
  const to = positions.documentToSource(step.to, "left");
  if (to < from) return { kind: "unsupported" };
  let inserted = inlineFragmentSource(step.slice.content);
  if (
    inserted === null
    && step.from === step.to
    && step.slice.openStart === 1
    && step.slice.openEnd === 1
    && step.slice.content.childCount === 2
    && step.slice.content.firstChild?.type.name === "paragraph"
    && step.slice.content.lastChild?.type.name === "paragraph"
  ) {
    // prosemirror-commands splitBlock represents Enter as two open empty
    // paragraph shells. The authored operation is an exact blank-line
    // separator at the current source boundary.
    inserted = "\n\n";
    reparseDerivedDocument = true;
  }
  if (inserted === null) return { kind: "unsupported" };
  const head = from + inserted.length;
  return {
    kind: "source",
    transaction: {
      edits: [{ from, to, insert: inserted }],
      selection: { anchor: head, head },
      origin: inserted.length === 0 ? "delete" : "input",
    },
    ...(reparseDerivedDocument ? { reparseDerivedDocument: true } : {}),
  };
}
