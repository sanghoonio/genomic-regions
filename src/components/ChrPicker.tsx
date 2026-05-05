// Chromosome picker — chip-styled dropdown matching ColorByPicker /
// IntervalPicker. Currently a placeholder: only chr16 has data wired up,
// but the picker exposes all canonical hg38 chromosomes so the UI shows
// where multi-chromosome support will land.

import { useEffect, useRef, useState } from 'react';
import { Dna } from 'lucide-react';

// Canonical hg38 chromosomes: 1–22 + X, Y, M.
const HG38_CHROMS: ReadonlyArray<string> = [
  ...Array.from({ length: 22 }, (_, i) => `chr${i + 1}`),
  'chrX',
  'chrY',
  'chrM',
];

export function ChrPicker({
  value,
  onChange,
  align = 'right',
}: {
  value: string;
  onChange: (chrom: string) => void;
  align?: 'left' | 'right';
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

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 -my-1 text-[10px] leading-none font-medium text-base-content/70 hover:text-base-content bg-base-100 hover:bg-base-200 border border-base-300 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer"
        title="Chromosome"
      >
        <Dna size={11} />
        {value}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-32 overflow-y-auto overscroll-contain max-h-80`}
          >
            <ul className="py-1">
              {HG38_CHROMS.map((c) => {
                const selected = c === value;
                // Only chr16 is actually wired up to data; the rest are
                // disabled placeholders so the UI shows where multi-chrom
                // support will land.
                const disabled = c !== 'chr16';
                return (
                  <li key={c}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        onChange(c);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1 text-xs transition-colors ${
                        disabled
                          ? 'text-base-content/30 cursor-not-allowed'
                          : selected
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'hover:bg-base-200'
                      }`}
                    >
                      {c}
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
