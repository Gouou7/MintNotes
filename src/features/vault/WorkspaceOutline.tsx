import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { OutlinePanel } from "../../components/OutlinePanel";
import type { OutlineItem, WorkspaceEditorMode } from "../../types";
import { trackActiveOutlineHeading } from "./outlineTracking";

const desktopQuery = "(min-width: 1101px)";
const isDesktop = () => window.matchMedia(desktopQuery).matches;
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

interface Props {
  items: readonly OutlineItem[];
  editorArea: RefObject<HTMLDivElement | null>;
  mode: WorkspaceEditorMode;
  collapsed: boolean;
  open: boolean;
  onSelect: (item: OutlineItem) => void;
}

/** Keep scroll-driven state inside this pane, and stop tracking while the pane is hidden. */
export function WorkspaceOutline({ items, editorArea, mode, collapsed, open, onSelect }: Props) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop);
  const enabled = desktop ? !collapsed : open;
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const area = editorArea.current;
    if (!enabled || !area || !items.length) return;
    return trackActiveOutlineHeading(area, mode, items, setActiveId);
  }, [editorArea, mode, items, enabled]);
  return <OutlinePanel items={items} activeId={activeId} onSelect={onSelect} />;
}
