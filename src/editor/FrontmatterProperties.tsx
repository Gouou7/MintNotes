import {
  AlignLeft,
  Braces,
  CalendarDays,
  Hash,
  Plus,
  Tags,
  ToggleLeft,
  Trash2,
  X
} from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { AppIcon } from "../components/AppIcon";
import { useI18n } from "../i18n";
import {
  addFrontmatterProperty,
  deleteFrontmatterProperty,
  isIsoDateValue,
  parseFrontmatter,
  renameFrontmatterProperty,
  setFrontmatterProperty,
  type FrontmatterProperty,
  type FrontmatterPropertyIcon
} from "./frontmatter";

interface Props {
  markdown: string;
  editable?: boolean;
  onChange?: (markdown: string) => void;
}

const ICONS = {
  text: AlignLeft,
  number: Hash,
  boolean: ToggleLeft,
  date: CalendarDays,
  tags: Tags,
  complex: Braces
} satisfies Record<FrontmatterPropertyIcon, typeof AlignLeft>;

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.currentTarget.blur();
}

function PropertyRow({
  markdown,
  property,
  editable,
  onChange
}: {
  markdown: string;
  property: FrontmatterProperty;
  editable: boolean;
  onChange?: (markdown: string) => void;
}) {
  const { t } = useI18n();
  const [keyDraft, setKeyDraft] = useState(property.key);
  const [valueDraft, setValueDraft] = useState(property.value === null ? "" : String(property.value));
  const [listDraft, setListDraft] = useState("");
  const [keyError, setKeyError] = useState("");
  const Icon = ICONS[property.icon];

  useEffect(() => setKeyDraft(property.key), [property.key]);
  useEffect(() => {
    if (!Array.isArray(property.value)) setValueDraft(property.value === null ? "" : String(property.value));
  }, [property.value]);

  const emit = (next: string) => {
    if (next !== markdown) onChange?.(next);
  };
  const commitKey = () => {
    const nextKey = keyDraft.trim();
    if (!nextKey) {
      setKeyError(t("properties.keyRequired"));
      setKeyDraft(property.key);
      return;
    }
    const next = renameFrontmatterProperty(markdown, property.key, nextKey);
    if (next === markdown && nextKey !== property.key) {
      setKeyError(t("properties.keyDuplicate"));
      setKeyDraft(property.key);
      return;
    }
    setKeyError("");
    emit(next);
  };
  const commitScalar = () => {
    let value: string | number | null = valueDraft;
    if (!valueDraft) value = null;
    else if (property.kind === "number") {
      const number = Number(valueDraft);
      if (!Number.isFinite(number)) {
        setValueDraft(String(property.value ?? ""));
        return;
      }
      value = number;
    }
    emit(setFrontmatterProperty(markdown, property.key, value));
  };
  const remove = () => emit(deleteFrontmatterProperty(markdown, property.key));
  const values = Array.isArray(property.value) ? property.value : [];
  const addListValue = () => {
    const additions = listDraft.split(",").map((value) => value.trim()).filter(Boolean);
    if (!additions.length) return;
    setListDraft("");
    emit(setFrontmatterProperty(markdown, property.key, [...values, ...additions]));
  };

  return (
    <div className={`property-row ${property.kind === "complex" ? "property-complex" : ""}`}>
      <span className="property-type-icon" title={property.kind}><AppIcon icon={Icon} size={18} /></span>
      {editable && property.kind !== "complex"
        ? <span className="property-key-editor">
          <input
            value={keyDraft}
            onChange={(event) => { setKeyDraft(event.target.value); setKeyError(""); }}
            onBlur={commitKey}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setKeyDraft(property.key);
                setKeyError("");
                event.currentTarget.blur();
              } else blurOnEnter(event);
            }}
            aria-label={t("properties.key")}
            aria-invalid={Boolean(keyError)}
          />
          {keyError && <small role="alert">{keyError}</small>}
        </span>
        : <strong className="property-key">{property.key}</strong>}
      <div className="property-value">
        {property.kind === "complex"
          ? <span className="property-complex-value" title={t("properties.complexHint")}>
            {property.complexPreview || t("properties.complexValue")}
          </span>
          : property.kind === "boolean"
          ? <label className="property-checkbox">
            <input
              type="checkbox"
              checked={Boolean(property.value)}
              disabled={!editable}
              onChange={(event) => emit(setFrontmatterProperty(markdown, property.key, event.target.checked))}
            />
            <span>{String(Boolean(property.value))}</span>
          </label>
          : property.kind === "list"
          ? <div className="property-list-editor">
            {values.map((value, index) => <span className="property-chip" key={`${value}:${index}`}>
              {value || t("properties.noValue")}
              {editable && <button
                type="button"
                onClick={() => emit(setFrontmatterProperty(markdown, property.key, values.filter((_, itemIndex) => itemIndex !== index)))}
                aria-label={t("properties.removeListValue", { value })}
              ><AppIcon icon={X} size={12} /></button>}
            </span>)}
            {editable && <input
              value={listDraft}
              onChange={(event) => setListDraft(event.target.value)}
              onBlur={addListValue}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addListValue();
                }
              }}
              placeholder={values.length ? t("properties.addListValue") : t("properties.noValue")}
              aria-label={t("properties.addListValue")}
            />}
            {!editable && !values.length && <span className="property-empty">{t("properties.noValue")}</span>}
          </div>
          : editable
          ? <input
            className="property-scalar-input"
            type={property.kind === "date" && (property.value === null || isIsoDateValue(property.value)) ? "date" : property.kind === "number" ? "number" : "text"}
            value={valueDraft}
            onChange={(event) => setValueDraft(event.target.value)}
            onBlur={commitScalar}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setValueDraft(property.value === null ? "" : String(property.value));
                event.currentTarget.blur();
              } else blurOnEnter(event);
            }}
            placeholder={t("properties.noValue")}
            aria-label={t("properties.value", { key: property.key })}
          />
          : <span className={property.value === null || property.value === "" ? "property-empty" : ""}>
            {property.value === null || property.value === "" ? t("properties.noValue") : String(property.value)}
          </span>}
      </div>
      {editable && property.kind !== "complex" && <button
        className="property-remove"
        type="button"
        onClick={remove}
        title={t("properties.remove")}
        aria-label={t("properties.removeNamed", { key: property.key })}
      ><AppIcon icon={Trash2} size={15} /></button>}
    </div>
  );
}

export function FrontmatterProperties({ markdown, editable = false, onChange }: Props) {
  const { t } = useI18n();
  const parsed = parseFrontmatter(markdown);

  if (parsed.status === "absent") return null;
  if (parsed.status === "invalid") {
    return (
      <section className="properties-panel properties-invalid" aria-label={t("properties.title")}>
        <h2>{t("properties.title")}</h2>
        <p role="alert">{t("properties.invalid")}</p>
        <pre>{parsed.yamlSource}</pre>
        <small>{t("properties.sourceHint")}</small>
      </section>
    );
  }

  const addProperty = () => {
    const keys = new Set(parsed.properties.map((property) => property.key));
    let key = "property";
    for (let suffix = 2; keys.has(key); suffix++) key = `property-${suffix}`;
    const next = addFrontmatterProperty(markdown, key);
    if (next !== markdown) onChange?.(next);
  };

  return (
    <section className="properties-panel" aria-label={t("properties.title")}>
      <h2>{t("properties.title")}</h2>
      <div className="property-list">
        {parsed.properties.map((property, index) => <PropertyRow
          key={`${property.key}:${index}`}
          markdown={markdown}
          property={property}
          editable={editable}
          onChange={onChange}
        />)}
      </div>
      {editable && <button className="property-add" type="button" onClick={addProperty}>
        <AppIcon icon={Plus} size={18} />{t("properties.add")}
      </button>}
      {parsed.properties.some((property) => property.kind === "complex") && <small className="properties-complex-hint">
        {t("properties.complexHint")}
      </small>}
    </section>
  );
}
