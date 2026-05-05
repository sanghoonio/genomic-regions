// DictPanel — full-width, height-filling variant of the dictionary entry
// for inline use in a flex column (e.g., the right column of Draft 2).
// Same data source as DictCard (NPMI partners under the active pool) but
// no UMAPCard header and no fixed width — the panel fills its parent's
// remaining vertical space and stretches to the column's width.
//
// Renders a placeholder when no region is picked so the panel still
// occupies its slot rather than collapsing to zero height.

import type { PickedRegion } from './RegionUMAP';
import { SCREEN_CLASS_COLORS } from '../lib/colors';
import { useTokenNpmiPartners, type PartnerRow } from '../hooks/usePartners';

export function DictPanel({
  picked,
  isReady,
  customFileIds,
}: {
  picked: PickedRegion | null;
  isReady: boolean;
  customFileIds?: ReadonlyArray<string> | null;
}) {
  const tokenId = picked?.token_id ?? null;
  const { rows: npmiPartners, meta: npmiMeta, loading: npmiLoading } =
    useTokenNpmiPartners(tokenId, 12, 5, customFileIds);

  return (
    <div className="flex-1 min-h-0 w-full bg-base-100 border border-base-300 rounded-lg p-3 flex flex-col gap-2 overflow-y-auto">
      {!isReady ? (
        <span className="text-xs text-base-content/50">Initializing…</span>
      ) : !picked ? (
        <span className="text-xs text-base-content/50">
          Click a region on the region UMAP to populate the dictionary entry.
        </span>
      ) : (
        <PickedContent
          picked={picked}
          npmiPartners={npmiPartners}
          npmiLoading={npmiLoading}
          npmiMeta={npmiMeta}
          poolLabel={
            customFileIds && customFileIds.length > 0
              ? `${customFileIds.length.toLocaleString()} files`
              : 'full corpus'
          }
        />
      )}
    </div>
  );
}

function PickedContent({
  picked,
  npmiPartners,
  npmiLoading,
  npmiMeta,
  poolLabel,
}: {
  picked: PickedRegion;
  npmiPartners: PartnerRow[] | null;
  npmiLoading: boolean;
  npmiMeta: { n_files_active: number; n_files_in_pool: number } | null;
  poolLabel: string;
}) {
  const cclassColor =
    SCREEN_CLASS_COLORS[picked.cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  return (
    <>
      {/* Region header */}
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm text-base-content">
          {picked.region}
        </span>
        <span
          className="badge badge-sm text-white border-0"
          style={{ backgroundColor: cclassColor }}
        >
          {picked.cclass}
        </span>
        <span className="text-[11px] text-base-content/60 tabular-nums">
          token {picked.token_id.toLocaleString()} ·{' '}
          {(picked.end - picked.start).toLocaleString()} bp
        </span>
      </div>

      {/* NPMI partners */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[11px] font-semibold text-warning">
          NPMI partners · {poolLabel}
        </div>
        {npmiLoading && !npmiPartners ? (
          <span className="loading loading-dots loading-sm text-base-content/40" />
        ) : !npmiPartners || npmiPartners.length === 0 ? (
          <div className="text-[11px] text-base-content/50">
            No partners in this pool (token may not have passed PPMI floor).
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {npmiPartners.map((p) => (
              <PartnerChip key={`${p.partner_token_id}-${p.rank}`} partner={p} />
            ))}
          </div>
        )}
        {npmiMeta && (
          <div className="text-[10px] text-base-content/50">
            Token active in {npmiMeta.n_files_active.toLocaleString()} of{' '}
            {npmiMeta.n_files_in_pool.toLocaleString()} files in pool.
          </div>
        )}
      </div>
    </>
  );
}

function PartnerChip({ partner }: { partner: PartnerRow }) {
  const color =
    SCREEN_CLASS_COLORS[partner.partner_cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-base-100 border border-base-300 px-1.5 py-0.5 font-mono text-[11px] leading-tight"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      title={`${partner.partner_region} (${partner.partner_cclass}) — npmi=${partner.weight.toFixed(3)}`}
    >
      <span style={{ color }} className="font-semibold">
        {partner.partner_cclass}
      </span>
      <span className="text-base-content/80">{partner.partner_region}</span>
      <span className="text-base-content/50 tabular-nums">
        {partner.weight.toFixed(3)}
      </span>
    </span>
  );
}
