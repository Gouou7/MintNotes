export type LiveSyntaxState = "editing" | "rendering";

export const LIVE_SYNTAX_EDITING: LiveSyntaxState = "editing";
export const LIVE_SYNTAX_RENDERING: LiveSyntaxState = "rendering";

export function isLiveSyntaxEditing(value: unknown): boolean {
  return value === LIVE_SYNTAX_EDITING;
}
