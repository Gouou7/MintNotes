import { useEffect, useRef, useState } from "react";
import { focusAndSelectName } from "../features/focusName";

interface Props {
  initialValue: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}

export function TreeRenameInput({ initialValue, label, onCommit, onCancel, className = "tree-rename-input" }: Props) {
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => { focusAndSelectName(input.current); }, []);

  return <input
    ref={input}
    className={className}
    value={value}
    onChange={(event) => setValue(event.target.value)}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
    onBlur={() => { if (!cancelled.current) onCommit(value); }}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelled.current = true;
        onCancel();
      }
    }}
    aria-label={label}
  />;
}
