import type { ChangeEvent, FocusEvent, KeyboardEvent, RefObject } from "react";
import {
  ImagePlus,
  LockKeyhole,
  LockKeyholeOpen,
  PanelLeftOpen,
  PanelRightOpen,
  Sparkles
} from "lucide-react";
import { AppIcon } from "../../components/AppIcon";
import { useI18n } from "../../i18n";
import type { WorkspaceEditorMode } from "../workspace";

interface NoteToolbarProps {
  titleInput: RefObject<HTMLInputElement | null>;
  active: boolean;
  title: string;
  titleReadOnly: boolean;
  locked: boolean;
  historyPreview: boolean;
  displayedMode: WorkspaceEditorMode;
  onOpenLeft: () => void;
  onTitleChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTitleBlur: (event: FocusEvent<HTMLInputElement>) => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onModeChange: (mode: WorkspaceEditorMode) => void;
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
  displayedMode,
  onOpenLeft,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  onModeChange,
  onToggleLock,
  onAddImage,
  onOpenRight
}: NoteToolbarProps) {
  const { t } = useI18n();
  const modeDisabled = !active || historyPreview || locked;
  const noteActionDisabled = !active || historyPreview;

  return <header className="note-toolbar">
    <button className="pane-toggle" onClick={onOpenLeft} aria-label={t("app.openLeft")}><AppIcon icon={PanelLeftOpen} /></button>
    {active
      ? <input
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
    <div className="mode-switch" aria-label={t("app.displayMode")}>
      <button disabled={modeDisabled} className={active && displayedMode === "live" ? "active" : ""} onClick={() => onModeChange("live")}>{t("app.modeLive")}</button>
      <button disabled={modeDisabled} className={active && displayedMode === "source" ? "active" : ""} onClick={() => onModeChange("source")}>{t("app.modeSource")}</button>
      <button disabled={modeDisabled} className={active && displayedMode === "readonly" ? "active" : ""} onClick={() => onModeChange("readonly")}>{t("app.modeReading")}</button>
    </div>
    <button
      className={`toolbar-icon note-lock-toggle ${active && locked ? "active" : ""}`}
      disabled={noteActionDisabled}
      onClick={onToggleLock}
      title={locked ? t("app.unlockNote") : t("app.lockNote")}
      aria-label={locked ? t("app.unlockNote") : t("app.lockNote")}
      aria-pressed={active && locked}
    ><AppIcon icon={active && locked ? LockKeyholeOpen : LockKeyhole} /></button>
    <button
      className="toolbar-icon"
      disabled={noteActionDisabled || locked}
      onClick={onAddImage}
      title={locked ? t("app.unlockToEdit") : t("app.addImage")}
      aria-label={t("app.addImage")}
    ><AppIcon icon={ImagePlus} /></button>
    <button className="toolbar-icon right-pane-toggle" onClick={onOpenRight} aria-label={t("app.openRight")}><AppIcon icon={PanelRightOpen} /></button>
  </header>;
}

export function EmptyEditor() {
  const { t } = useI18n();
  return <div className="empty-editor">
    <div className="empty-icon"><AppIcon icon={Sparkles} size={34} /></div>
    <h2>{t("app.emptyTitle")}</h2>
  </div>;
}
