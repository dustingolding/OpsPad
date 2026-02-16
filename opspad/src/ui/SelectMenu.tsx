import { useMemo, useState } from "react";

import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

export type SelectOption = { value: string; label: string };

export function SelectMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const current = useMemo(() => options.find((o) => o.value === value)?.label ?? value, [options, value]);

  const items: ContextMenuItem[] = useMemo(
    () =>
      options.map((o) => ({
        label: o.label,
        disabled: o.value === value,
        onClick: () => onChange(o.value),
      })),
    [options, onChange, value],
  );

  return (
    <div className="field">
      <span className="fieldLabel">{label}</span>
      <button
        className="textInput selectButton"
        type="button"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
          setPos({ x: Math.round(r.left), y: Math.round(r.bottom + 6) });
          setOpen(true);
        }}
      >
        <span>{current}</span>
        <span className="selectChevron" aria-hidden="true">
          ▾
        </span>
      </button>

      <ContextMenu open={open} x={pos.x} y={pos.y} items={items} onClose={() => setOpen(false)} />
    </div>
  );
}

