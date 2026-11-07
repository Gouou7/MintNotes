import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import type { ChangeEvent, FocusEvent, KeyboardEvent, RefObject } from "react";
import {
  CodeXml,
  FileLock2,
  ImagePlus,
  PanelLeftOpen,
  PanelRightOpen,
  PencilOff,
  Sparkles
} from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { useI18n } from "../../i18n";

interface NoteToolbarProps {
  titleInput: RefObject<HTMLInputElement | null>;
  active: boolean;
  title: string;
  titleReadOnly: boolean;
  locked: boolean;
  historyPreview: boolean;
  sourceMode: boolean;
  readOnly: boolean;
  onOpenLeft: () => void;
  onTitleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTitleBlur: (event: FocusEvent<HTMLInputElement>) => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onToggleSource: () => void;
  onToggleReadOnly: () => void;
  onToggleLock: () => void;
  onAddImage: () => void;
  onOpenRight: () => void;
}

export function NoteToolbar({
  titleInput,
  active,
  title,
  titleReadOnly,
  locked,
  historyPreview,
  sourceMode,
  readOnly,
  onOpenLeft,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  onToggleSource,
  onToggleReadOnly,
  onToggleLock,
  onAddImage,
  onOpenRight
}: NoteToolbarProps) {
  const { t } = useI18n();
  const modeDisabled = !active || historyPreview;
  const noteActionDisabled = !active || historyPreview;

  return <header className="note-toolbar">
    <Button className="pane-toggle" onClick={onOpenLeft} title={t("app.openLeft")} aria-label={t("app.openLeft")}><AppIcon icon={PanelLeftOpen} size={16} /></Button>
    {active
      ? <Input
          ref={titleInput}
          className="title-input"
          value={title}
          readOnly={titleReadOnly}
          onChange={onTitleChange}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
          aria-label={t("app.noteTitle")}
        />
      : <strong className="empty-title-slot">{t("app.selectNote")}</strong>}
    <Button
      className="toolbar-icon"
      disabled={noteActionDisabled || readOnly}
      onClick={onAddImage}
      title={locked ? t("app.unlockToEdit") : t("app.addImage")}
      aria-label={t("app.addImage")}
    ><AppIcon icon={ImagePlus} size={16} strokeWidth={1.5} /></Button>
    <Button
      className={`toolbar-icon note-lock-toggle ${active && locked ? "active" : ""}`}
      disabled={noteActionDisabled}
      onClick={onToggleLock}
      title={locked ? t("app.unlockNote") : t("app.lockNote")}
      aria-label={locked ? t("app.unlockNote") : t("app.lockNote")}
      aria-pressed={active && locked}
    ><AppIcon icon={FileLock2} size={16} strokeWidth={1.5} /></Button>
    <ToggleGroup multiple className="mode-switch" aria-label={t("app.editorMode")}
      value={active ? [...(readOnly ? ["reading"] : []), ...(sourceMode ? ["source"] : [])] : []}
      onValueChange={(values) => {
        if (!modeDisabled && !locked && values.includes("reading") !== readOnly) onToggleReadOnly();
        if (!modeDisabled && values.includes("source") !== sourceMode) onToggleSource();
      }}>
      <ToggleGroupItem value="reading" disabled={modeDisabled || locked} title={t("app.modeReading")} aria-label={t("app.modeReading")}><AppIcon icon={PencilOff} strokeWidth={1.5} /></ToggleGroupItem>
      <ToggleGroupItem value="source" disabled={modeDisabled} title={t("app.modeSource")} aria-label={t("app.modeSource")}><AppIcon icon={CodeXml} strokeWidth={1.5} /></ToggleGroupItem>
    </ToggleGroup>
    <Button className="toolbar-icon right-pane-toggle" onClick={onOpenRight} title={t("app.openRight")} aria-label={t("app.openRight")}><AppIcon icon={PanelRightOpen} size={16} /></Button>
  </header>;
}

export function EmptyEditor() {
  const { t } = useI18n();
  return <Empty className="empty-editor">
    <EmptyHeader>
      <EmptyMedia className="empty-icon"><AppIcon icon={Sparkles} size={34} /></EmptyMedia>
      <h2 className="empty-editor-title">{t("app.emptyTitle")}</h2>
    </EmptyHeader>
  </Empty>;
}
