function fragmentId(href: string): string | null {
  if (!href.startsWith("#") || href.length === 1) return null;
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

/** Navigate within one rendered document without mutating the application URL. */
export function navigateToDocumentFragment(root: ParentNode, href: string): boolean {
  const id = fragmentId(href);
  if (!id) return false;
  const target = [...root.querySelectorAll<HTMLElement>("[id]")]
    .find((candidate) => candidate.id === id);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (target.matches("a[href], button, input, [tabindex]")) {
    target.focus({ preventScroll: true });
  }
  return true;
}
