// Featured-interval picker. Chip-button styled (matches LensPicker /
// ColorByPicker) so it can sit in a UMAPCard `actions` slot. Caller owns
// the selection state.

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { CandidateInterval } from '../lib/candidateIntervals';

export type IntervalPickerProps = {
  intervals: CandidateInterval[];
  value: string | null; // interval_id
  onChange: (interval: CandidateInterval) => void;
  loading?: boolean;
  /** Which edge of the trigger the dropdown anchors to. Default `right`
   * matches the original UMAPCard `actions` slot (right-aligned chips);
   * use `left` when the trigger sits on the left side of the page. */
  align?: 'left' | 'right';
};

export function IntervalPicker({
  intervals,
  value,
  onChange,
  loading,
  align = 'right',
}: IntervalPickerProps) {
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

  const current = intervals.find((iv) => iv.interval_id === value);
  const triggerLabel =
    intervals.length === 0
      ? loading
        ? 'Loading…'
        : 'No intervals'
      : (current?.label ?? 'Pick interval');

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        disabled={loading || intervals.length === 0}
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 -my-1 text-[10px] leading-none font-medium text-base-content/70 hover:text-base-content bg-base-100 hover:bg-base-200 border border-base-300 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed max-w-56 truncate"
        title="Featured interval"
      >
        <MapPin size={11} className="shrink-0" />
        <span className="truncate">{triggerLabel}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-72 overflow-y-auto overscroll-contain max-h-96`}
          >
            <ul className="py-1">
              {intervals.map((iv) => (
                <li key={iv.interval_id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(iv);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      iv.interval_id === value
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-base-200'
                    }`}
                  >
                    {iv.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
