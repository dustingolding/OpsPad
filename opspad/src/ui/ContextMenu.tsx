import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem =
  | { kind?: "item"; label: string; onClick: () => void; disabled?: boolean }
  | { kind: "sep" }
  | { kind: "header"; label: string };

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const safeItems = useMemo(() => items.filter(Boolean), [items]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      // Only close on primary click outside. Right-click is used to open menus.
      if (e.button !== 0) return;
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="ctxOverlay" role="presentation">
      <div
        ref={rootRef}
        className="ctxMenu"
        role="menu"
        style={{ left: x, top: y }}
      >
        {safeItems.map((it, idx) => {
          if (it.kind === "sep") return <div key={`sep-${idx}`} className="ctxSep" role="separator" />;
          if (it.kind === "header") return <div key={`hdr-${idx}`} className="ctxHeader">{it.label}</div>;
          const disabled = !!it.disabled;
          return (
            <button
              key={`item-${idx}`}
              className={disabled ? "ctxItem ctxItemDisabled" : "ctxItem"}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                onClose();
                it.onClick();
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
