import { LANGUAGE_OPTIONS, type LanguagePreference, useI18n } from "../i18n";

export function LanguageSelect({
  value,
  onChange,
  className
}: {
  value: LanguagePreference;
  onChange: (value: LanguagePreference) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <select
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value as LanguagePreference)}
      aria-label={t("language.selector")}
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.value === "system" ? t("language.system") : option.label}
        </option>
      ))}
    </select>
  );
}
