// 3-mode picker for Section 1: continuous → peaks → tokens. Chip-button
// styled (matches LensPicker / ColorByPicker) so it sits in a UMAPCard
// `actions` slot alongside the IntervalPicker.
//
// "Continuous" and "peaks" require precomputed featured_signal /
// featured_tracks data, which only exists for the 4 reference intervals.
// `disabledModes` lets the parent grey those out for hub candidates.

import { useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, Boxes } from 'lucide-react';

export type Section1Mode = 'continuous' | 'peaks' | 'tokens';

const MODE_LABELS: Record<Section1Mode, { label: string; icon: typeof Activity }> = {
  continuous: { label: 'Continuous', icon: Activity },
  peaks: { label: 'Peaks', icon: BarChart3 },
  tokens: { label: 'Tokens', icon: Boxes },
};

const MODES: Section1Mode[] = ['continuous', 'peaks', 'tokens'];

export function Section1ModeToggle({
  value,
  onChange,
  disabledModes = [],
}: {
  value: Section1Mode;
  onChange: (m: Section1Mode) => void;
  disabledModes?: Section1Mode[];
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

  const Current = MODE_LABELS[value];
  const Icon = Current.icon;

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 text-[10px] font-medium text-base-content/70 hover:text-base-content bg-base-100 hover:bg-base-200 border border-base-300 px-2 py-1 rounded-md transition-colors cursor-pointer"
        title="View mode"
      >
        <Icon size={11} />
        {Current.label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-40 overflow-y-auto max-h-80">
            <ul className="py-1">
              {MODES.map((m) => {
                const { label, icon: ItemIcon } = MODE_LABELS[m];
                const disabled = disabledModes.includes(m);
                const selected = m === value;
                return (
                  <li key={m}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        onChange(m);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                        disabled
                          ? 'text-base-content/30 cursor-not-allowed'
                          : selected
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'hover:bg-base-200'
                      }`}
                    >
                      <ItemIcon size={12} />
                      {label}
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
