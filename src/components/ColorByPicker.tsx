// Small dropdown button rendered in a UMAPCard header's `actions` slot.
// Lets the user switch which categorical column the embedding-atlas plot
// colors by. Mirrors bedbase-ui's ColorByManager (chip variant).

import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';

export type ColorByOption = {
  key: string;
  label: string;
  /** When false, the option appears greyed out and isn't selectable. */
  available?: boolean;
  /** Optional muted hint shown next to the label, e.g. "(brush files first)". */
  hint?: string;
};

export function ColorByPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (key: string) => void;
  options: ReadonlyArray<ColorByOption>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = options.find((o) => o.key === value);

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 -my-1 text-[11px] leading-none font-medium text-base-content/70 hover:text-base-content bg-base-100 hover:bg-base-200 border border-base-300 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer"
        title="Color by…"
      >
        <Palette size={11} />
        {current?.label ?? value}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-60 overflow-y-auto overscroll-contain max-h-80">
            <ul className="py-1">
              {options.map((opt) => {
                const disabled = opt.available === false;
                const selected = opt.key === value;
                return (
                  <li key={opt.key}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        onChange(opt.key);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1 text-xs flex items-center justify-between gap-2 transition-colors ${
                        disabled
                          ? 'text-base-content/30 cursor-not-allowed'
                          : selected
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'hover:bg-base-200'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {opt.hint && (
                        <span className="text-[11px] text-base-content/40">
                          {opt.hint}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
