// Dictionary entry — a fudoki-inspired flow row of partner chips. The
// picked region's chip sits in its natural genomic position within the
// row; partners with smaller starts precede it, larger starts follow.
// Width per chip encodes the rank of the partner region's bp size
// (longest region widest, shortest narrowest). Clicking a partner pans
// the chr-distribution strip to that partner's midpoint.
//
// Renders a placeholder when no region is picked.

import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { PickedRegion } from './RegionUMAP';
import { SCREEN_CLASS_COLORS } from '../lib/colors';
import { useTokenNpmiPartners, type PartnerRow } from '../hooks/usePartners';

// Tooltip wiring shared across PartnerStrip + PickedChip + PartnerChip
// — the panel mounts a single floating tooltip div and these closures
// populate / position / hide it on chip hover. Direct DOM mutation so
// mousemove doesn't churn React state on every pixel.
type ShowTip = (event: ReactMouseEvent, html: string) => void;
type HideTip = () => void;

const CCLASS_ABBREV: Record<string, string> = {
  PLS: 'PLS',
  pELS: 'pELS',
  dELS: 'dELS',
  'CA-CTCF': 'CTCF',
  'CA-H3K4me3': 'K4me3',
  'CA-TF': 'CA-TF',
  CA: 'CA',
  TF: 'TF',
  unclassed: '—',
};

// Width encodes the rank of the partner region's bp size: the longest
// region gets CHIP_MAX_WIDTH_PX, the shortest gets CHIP_MIN_WIDTH_PX.
// Min is wide enough that the longest possible distance label
// (e.g., "−12.34 Mb") never wraps, so the row stays a clean
// single-line glyph per chip even at the lowest ranks.
const CHIP_MIN_WIDTH_PX = 104;
const CHIP_MAX_WIDTH_PX = 180;

// Signed-distance label, scaled by magnitude. `0` for the picked
// chip; everything else gets `+` / `−` (unicode minus) followed by a
// kb or Mb amount. Mb uses 2 decimals near the boundary so 1.05 Mb
// reads as fine-grained, larger jumps lose precision.
function formatDistance(deltaBp: number): string {
  if (deltaBp === 0) return '0';
  const sign = deltaBp > 0 ? '+' : '−';
  const abs = Math.abs(deltaBp);
  if (abs < 1_000_000) return `${sign}${(abs / 1_000).toFixed(0)} kb`;
  return `${sign}${(abs / 1_000_000).toFixed(2)} Mb`;
}

// HTML body for the picked chip's hover tooltip — leads with the
// "you are here" role line, then the canonical chr:start-end label,
// the cclass + a colored class swatch, and the click affordance.
function formatPickedChipTip(picked: PickedRegion, color: string): string {
  return (
    `<div><span class="text-primary font-semibold">⊙ picked</span></div>` +
    `<div class="font-mono text-base-content">${escapeHtml(picked.region)}</div>` +
    `<div class="flex items-center gap-1.5">` +
    `<span class="inline-block w-2 h-2 rounded-sm" style="background:${color}"></span>` +
    `<span class="font-semibold">${escapeHtml(picked.cclass)}</span>` +
    `<span class="text-base-content/50">· ${(picked.end - picked.start).toLocaleString()} bp</span>` +
    `</div>` +
    `<div class="text-base-content/50">click to recenter zoom</div>`
  );
}

// HTML body for a partner chip — role line, region label, cclass +
// swatch, NPMI weight, signed distance from pick, click affordance.
function formatPartnerChipTip(
  partner: PartnerRow,
  distanceBp: number,
  color: string,
): string {
  return (
    `<div><span class="text-warning font-semibold">★ partner</span></div>` +
    `<div class="font-mono text-base-content">${escapeHtml(partner.partner_region)}</div>` +
    `<div class="flex items-center gap-1.5">` +
    `<span class="inline-block w-2 h-2 rounded-sm" style="background:${color}"></span>` +
    `<span class="font-semibold">${escapeHtml(partner.partner_cclass)}</span>` +
    `</div>` +
    `<div><span class="text-base-content/60">NPMI</span> <span class="font-semibold tabular-nums">${partner.weight.toFixed(3)}</span></div>` +
    `<div><span class="text-base-content/60">${formatDistance(distanceBp)}</span> from pick</div>` +
    `<div class="text-base-content/50">click to pan zoom + recenter UMAP</div>`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Programmatic one-line summary of how the partners sit relative to
// the picked region. Two heuristic axes: spatial proximity (median
// absolute distance) and class similarity (fraction sharing the
// anchor's cclass). The phrasing is intentionally hedged — these are
// quick reads, not statistical claims.
function summarizeStrip(
  picked: PickedRegion,
  partners: PartnerRow[],
): string {
  const n = partners.length;
  if (n === 0) return '';

  // Median absolute distance from the anchor (signed-direction
  // doesn't matter for "how spread out is this neighborhood").
  const dists = partners
    .map((p) =>
      Math.abs(Math.round((p.partner_start + p.partner_end) / 2) - picked.midpoint),
    )
    .sort((a, b) => a - b);
  const medianDist = dists[Math.floor(n / 2)];

  let proximity: string;
  if (medianDist < 50_000) proximity = 'cluster tightly around the anchor';
  else if (medianDist < 500_000)
    proximity = 'cluster within the local neighborhood';
  else if (medianDist < 2_000_000)
    proximity = 'spread across a wider neighborhood';
  else if (medianDist < 5_000_000)
    proximity = 'span a multi-Mb region of the chromosome';
  else proximity = 'scatter across the chromosome';

  // Class composition vs anchor.
  const sameClass = partners.filter(
    (p) => p.partner_cclass === picked.cclass,
  ).length;
  const sameFrac = sameClass / n;
  const classCounts: Record<string, number> = {};
  for (const p of partners) {
    classCounts[p.partner_cclass] =
      (classCounts[p.partner_cclass] ?? 0) + 1;
  }
  const [dominantClass, dominantCount] =
    Object.entries(classCounts).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];

  let classPhrase: string;
  if (sameFrac === 1)
    classPhrase = `all share the anchor's ${picked.cclass} class`;
  else if (sameFrac >= 0.75)
    classPhrase = `mostly share the anchor's ${picked.cclass} class`;
  else if (sameFrac >= 0.5)
    classPhrase = `lean toward the anchor's ${picked.cclass} class`;
  else if (dominantCount / n >= 0.5)
    classPhrase = `lean ${dominantClass} rather than the anchor's ${picked.cclass}`;
  else classPhrase = 'span a mix of regulatory classes';

  return `These ${n} partners ${proximity} and ${classPhrase}.`;
}

export type DictNavTarget = {
  /** Token id of the clicked region. The Home page uses this to fire
   * the cross-view "ping" highlight. */
  tokenId: number;
  /** bp midpoint — recenters the chr-dist zoom windows. */
  position: number;
  /** UMAP coords — recenters the region UMAP (bedbase centerOnPoint). */
  umap_x: number;
  umap_y: number;
};

export function DictPanel({
  picked,
  isReady,
  customFileIds,
  ping,
  onNavigate,
}: {
  picked: PickedRegion | null;
  isReady: boolean;
  customFileIds?: ReadonlyArray<string> | null;
  /** Cross-view ping target. When `ping.tokenId` matches a chip's
   * token, that chip briefly animates a ring around itself. The
   * timestamp `t` is included in the chip's React key so consecutive
   * pings on the same id retrigger the animation. */
  ping?: { tokenId: number; t: number } | null;
  /** Called when the user clicks any chip (picked or partner). Parent
   * uses the supplied target to pan the chr-dist windows AND recenter
   * the region UMAP — analog of bedbase-ui's centerOnPoint. */
  onNavigate?: (target: DictNavTarget) => void;
}) {
  const tokenId = picked?.token_id ?? null;
  const { rows: npmiPartners, meta: npmiMeta, loading: npmiLoading } =
    useTokenNpmiPartners(tokenId, 30, 5, customFileIds);

  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Cursor-relative tooltip positioner — clamped to the panel's
  // visible box. The panel is `overflow-y-auto` so absolute children
  // scroll with the content; we add `scrollTop`/`scrollLeft` to the
  // visible-area cursor coordinates so the tooltip lands at the
  // cursor regardless of how far the strip has wrapped.
  const showTip: ShowTip = (event, html) => {
    const tip = tooltipRef.current;
    const wrap = containerRef.current;
    if (!tip || !wrap) return;
    tip.innerHTML = html;
    const wRect = wrap.getBoundingClientRect();
    const visibleW = wrap.clientWidth;
    const visibleH = wrap.clientHeight;
    const cx = event.clientX - wRect.left;
    const cy = event.clientY - wRect.top;
    tip.style.visibility = 'visible';
    const tRect = tip.getBoundingClientRect();
    const offset = 12;
    const xVisible = Math.max(
      4,
      Math.min(visibleW - tRect.width - 4, cx + offset),
    );
    const yVisible = Math.max(
      4,
      Math.min(visibleH - tRect.height - 4, cy + offset),
    );
    tip.style.left = `${wrap.scrollLeft + xVisible}px`;
    tip.style.top = `${wrap.scrollTop + yVisible}px`;
  };
  const hideTip: HideTip = () => {
    if (tooltipRef.current) tooltipRef.current.style.visibility = 'hidden';
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 w-full bg-base-100 border border-base-300 rounded-lg p-3 flex flex-col gap-2 overflow-y-auto"
    >
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
              ? `${customFileIds.length.toLocaleString()} ${customFileIds.length === 1 ? 'file' : 'files'}`
              : 'full corpus'
          }
          poolTooSmall={!!customFileIds && customFileIds.length < 2}
          ping={ping}
          onNavigate={onNavigate}
          showTip={showTip}
          hideTip={hideTip}
        />
      )}
      {/* Floating tooltip — kept always-mounted with visibility:hidden;
          chip hover handlers populate innerHTML + position. */}
      <div
        ref={tooltipRef}
        className="absolute z-30 bg-base-100 border border-base-300 rounded-md shadow-md px-2 py-1.5 text-[11px] leading-snug text-base-content pointer-events-none"
        style={{ visibility: 'hidden', left: 0, top: 0, maxWidth: '260px' }}
      />
    </div>
  );
}

function PickedContent({
  picked,
  npmiPartners,
  npmiLoading,
  npmiMeta,
  poolLabel,
  poolTooSmall,
  ping,
  onNavigate,
  showTip,
  hideTip,
}: {
  picked: PickedRegion;
  npmiPartners: PartnerRow[] | null;
  npmiLoading: boolean;
  npmiMeta: { n_files_active: number; n_files_in_pool: number } | null;
  poolLabel: string;
  /** True when the brushed file pool has < 2 files — NPMI needs at
   * least two files to estimate co-occurrence probabilities, so we
   * short-circuit the partners block with a guidance note. */
  poolTooSmall: boolean;
  ping?: { tokenId: number; t: number } | null;
  onNavigate?: (target: DictNavTarget) => void;
  showTip: ShowTip;
  hideTip: HideTip;
}) {
  const cclassColor =
    SCREEN_CLASS_COLORS[picked.cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  return (
    <>
      {/* Region header — restores the pre-strip caption: region name +
          cclass badge + token id / region width. */}
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
        <span className="text-xs text-base-content/60 tabular-nums">
          {(picked.end - picked.start).toLocaleString()} bp
          {npmiMeta && !poolTooSmall && (
            <>
              {' · active in '}
              {npmiMeta.n_files_active.toLocaleString()} of{' '}
              {npmiMeta.n_files_in_pool.toLocaleString()} files
            </>
          )}
        </span>
      </div>

      {/* Partner section caption — when an NPMI re-fetch is in flight
          AND we already have partners on screen, show a small dots
          spinner alongside the heading so the stale chips read as
          "about to refresh". */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-warning">
            Top 30 NPMI partners · {poolLabel}
          </span>
          {npmiLoading && npmiPartners && (
            <span
              className="loading loading-dots loading-xs text-base-content/40"
              title="Recomputing partners…"
            />
          )}
        </div>
        {/* NPMI gloss — kept inline so first-time readers can decode
            the term without leaving the panel. PMI captures how much
            more often two regions co-fire than chance; dividing by
            −log P(a,b) normalizes it to a fixed range so scores are
            comparable across token-pair frequencies. */}
        <p className="text-[11px] text-base-content/55 leading-snug">
          <span className="font-medium">NPMI</span> = normalized
          pointwise mutual information. PMI(a,b) ={' '}
          <span className="font-mono">log(P(a,b) / (P(a)·P(b)))</span>{' '}
          measures how much more often two regions co-fire than chance;
          dividing by{' '}
          <span className="font-mono">−log P(a,b)</span> normalizes the
          score into <span className="font-mono">[−1, 1]</span> so it's
          comparable across token-pair frequencies. Higher = stronger
          co-occurrence relative to baseline rates.
        </p>
        <p className="text-[11px] text-base-content/55 leading-snug mb-1">
          Tokens below are ordered by genomic start;{' '}
          <span className="font-medium">width</span> ranks the partner
          region's bp size, with longest widest and shortest narrowest.
          Tokens are colored by SCREEN class.
        </p>
      {poolTooSmall ? (
        <div className="text-[11px] text-warning/90 bg-warning/10 border border-warning/30 rounded-md px-2 py-1.5 leading-snug">
          NPMI needs at least 2 files in the pool to estimate co-occurrence.
          Brush a wider region of the BED embedding above to expand the pool.
        </div>
      ) : npmiLoading && !npmiPartners ? (
        <span className="loading loading-dots loading-sm text-base-content/40" />
      ) : !npmiPartners || npmiPartners.length === 0 ? (
        <div className="text-[11px] text-base-content/50">
          No partners in this pool (token may not have passed PPMI floor).
        </div>
      ) : (
        <>
          {/* Dim the chips while a re-fetch is in flight — they still
              read but visually pull back so the user notices fresher
              data is on the way. */}
          <div
            className={
              npmiLoading
                ? 'opacity-50 transition-opacity'
                : 'transition-opacity'
            }
          >
            <PartnerStrip
              picked={picked}
              partners={npmiPartners}
              ping={ping}
              onNavigate={onNavigate}
              showTip={showTip}
              hideTip={hideTip}
            />
          </div>
          <p className="text-[11px] italic text-base-content/60 leading-snug mt-1 flex items-center gap-1.5">
            <span className={npmiLoading ? 'opacity-50' : undefined}>
              {summarizeStrip(picked, npmiPartners)}
            </span>
            {npmiLoading && (
              <span className="loading loading-dots loading-xs text-base-content/30" />
            )}
          </p>
        </>
      )}
      </div>
    </>
  );
}

type StripEntry =
  | { kind: 'picked'; start: number; midpoint: number }
  | {
      kind: 'partner';
      partner: PartnerRow;
      start: number;
      midpoint: number;
      widthPx: number;
    };

function PartnerStrip({
  picked,
  partners,
  ping,
  onNavigate,
  showTip,
  hideTip,
}: {
  picked: PickedRegion;
  partners: PartnerRow[];
  ping?: { tokenId: number; t: number } | null;
  onNavigate?: (target: DictNavTarget) => void;
  showTip: ShowTip;
  hideTip: HideTip;
}) {
  // Build the ordered list: every partner + the picked region, sorted
  // ascending by start. The picked entry naturally lands at the index
  // that splits before/after partners — fudoki-style "you are here".
  const entries: StripEntry[] = [];
  const N = partners.length;
  // NPMI rank → opacity. Rank-based (not value-based) so the
  // opacity gradient is fully spread across the visible partners
  // even when their absolute NPMI values cluster in a narrow band
  // (top-30 NPMIs often sit between, say, 0.55–0.69).
  const opacityFor = (rank: number) => {
    if (N <= 1) return 1;
    return 1.0 - 0.6 * ((rank - 1) / (N - 1));
  };
  // Rank partners by bp width descending: the largest region gets
  // bpRank 0 (→ CHIP_MAX_WIDTH_PX), the smallest gets bpRank N-1
  // (→ CHIP_MIN_WIDTH_PX). NPMI rank is the tiebreak so the order is
  // stable across ties.
  const bpRankByOrigIdx = new Map<number, number>();
  partners
    .map((p, i) => ({ i, bp: p.partner_end - p.partner_start, npmiRank: p.rank }))
    .sort((a, b) => b.bp - a.bp || a.npmiRank - b.npmiRank)
    .forEach((entry, rankIdx) => bpRankByOrigIdx.set(entry.i, rankIdx));
  partners.forEach((p, i) => {
    const bpRank = bpRankByOrigIdx.get(i) ?? 0;
    const t = N > 1 ? bpRank / (N - 1) : 0;
    const widthPx = Math.round(
      CHIP_MAX_WIDTH_PX - t * (CHIP_MAX_WIDTH_PX - CHIP_MIN_WIDTH_PX),
    );
    const midpoint = Math.round((p.partner_start + p.partner_end) / 2);
    entries.push({
      kind: 'partner',
      partner: p,
      start: p.partner_start,
      midpoint,
      widthPx,
    });
  });
  entries.push({
    kind: 'picked',
    start: picked.start,
    midpoint: picked.midpoint,
  });
  entries.sort((a, b) => a.start - b.start);

  return (
    <div className="flex flex-wrap gap-1.5 items-stretch">
      {entries.map((e) =>
        e.kind === 'picked' ? (
          <PickedChip
            key={
              ping?.tokenId === picked.token_id
                ? `picked-${picked.token_id}-${ping.t}`
                : `picked-${picked.token_id}`
            }
            picked={picked}
            pinged={ping?.tokenId === picked.token_id}
            onClick={() =>
              onNavigate?.({
                tokenId: picked.token_id,
                position: picked.midpoint,
                umap_x: picked.umap_x,
                umap_y: picked.umap_y,
              })
            }
            showTip={showTip}
            hideTip={hideTip}
          />
        ) : (
          <PartnerChip
            key={
              ping?.tokenId === e.partner.partner_token_id
                ? `p-${e.partner.partner_token_id}-${ping.t}`
                : `p-${e.partner.partner_token_id}`
            }
            partner={e.partner}
            distanceBp={e.midpoint - picked.midpoint}
            widthPx={e.widthPx}
            opacity={opacityFor(e.partner.rank)}
            pinged={ping?.tokenId === e.partner.partner_token_id}
            onClick={() =>
              onNavigate?.({
                tokenId: e.partner.partner_token_id,
                position: e.midpoint,
                umap_x: e.partner.partner_umap_x,
                umap_y: e.partner.partner_umap_y,
              })
            }
            showTip={showTip}
            hideTip={hideTip}
          />
        ),
      )}
    </div>
  );
}

// Fudoki-inspired chip: page-color body with the position as the
// primary glyph; a small "chin" footer in the SCREEN-class color
// carries the abbreviation as a label. The chin is the chip's POS-tag
// equivalent — it both colors the chip and labels its class in one
// piece. Width scales with NPMI rank.
function Chin({ abbr, color }: { abbr: string; color: string }) {
  return (
    <span
      className="block w-full text-center text-[8px] uppercase tracking-wide font-medium text-white leading-tight px-1.5 py-0.5 rounded-b-sm"
      // SCREEN-class background — has to be inline since the palette
      // is data-driven.
      style={{ backgroundColor: color }}
    >
      {abbr}
    </span>
  );
}

function PickedChip({
  picked,
  pinged,
  onClick,
  showTip,
  hideTip,
}: {
  picked: PickedRegion;
  pinged?: boolean;
  onClick: () => void;
  showTip: ShowTip;
  hideTip: HideTip;
}) {
  const color =
    SCREEN_CLASS_COLORS[picked.cclass] ?? SCREEN_CLASS_COLORS.unclassed;
  const abbr = CCLASS_ABBREV[picked.cclass] ?? picked.cclass;
  const tipHtml = formatPickedChipTip(picked, color);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={(e) => showTip(e, tipHtml)}
      onMouseMove={(e) => showTip(e, tipHtml)}
      onMouseLeave={hideTip}
      className={`inline-flex flex-col items-stretch justify-end overflow-hidden rounded-sm hover:bg-base-200 transition-colors cursor-pointer text-center ${pinged ? 'ping-active' : ''}`}
      style={{ width: CHIP_MAX_WIDTH_PX }}
    >
      {/* No outline on the picked variant — the saturated inset ring
          and class-tinted body already do the "you are here" work and
          a faint border on top would just blur that signal. */}
      <span
        className="block w-full font-mono leading-tight px-2 pt-1 pb-1 rounded-t-sm"
        style={{
          backgroundColor: `${color}1f`, // ~12% alpha
          boxShadow: `inset 0 0 0 1.5px ${color}`,
        }}
      >
        <span className="block text-[9px] tabular-nums text-base-content/40">
          anchor
        </span>
        <span className="block text-[11px] font-semibold tabular-nums">
          {formatDistance(0)}
        </span>
      </span>
      <Chin abbr={abbr} color={color} />
    </button>
  );
}

function PartnerChip({
  partner,
  distanceBp,
  widthPx,
  opacity,
  pinged,
  onClick,
  showTip,
  hideTip,
}: {
  partner: PartnerRow;
  /** Signed bp distance to the picked region (partner.midpoint − picked.midpoint). */
  distanceBp: number;
  /** Pixel width — encodes NPMI rank (top is widest). */
  widthPx: number;
  /** 0–1 opacity, scaled to NPMI weight by the parent strip. */
  opacity: number;
  pinged?: boolean;
  onClick: () => void;
  showTip: ShowTip;
  hideTip: HideTip;
}) {
  const color =
    SCREEN_CLASS_COLORS[partner.partner_cclass] ??
    SCREEN_CLASS_COLORS.unclassed;
  const abbr = CCLASS_ABBREV[partner.partner_cclass] ?? partner.partner_cclass;
  const tipHtml = formatPartnerChipTip(partner, distanceBp, color);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={(e) => showTip(e, tipHtml)}
      onMouseMove={(e) => showTip(e, tipHtml)}
      onMouseLeave={hideTip}
      className={`inline-flex flex-col items-stretch justify-end overflow-hidden rounded-sm hover:bg-base-200 transition-colors cursor-pointer text-center ${pinged ? 'ping-active' : ''}`}
      style={{ width: widthPx, opacity }}
    >
      {/* Faint top + side outline on the text panel only — the chin
          stays a clean color block. */}
      <span className="block w-full font-mono leading-tight px-2 pt-1 pb-1 border-x border-t border-b-0 border-base-content/[0.06] rounded-t-sm">
        <span className="block text-[9px] tabular-nums text-base-content/45">
          {partner.weight.toFixed(3)}
        </span>
        <span className="block text-[11px] tabular-nums">
          {formatDistance(distanceBp)}
        </span>
      </span>
      <Chin abbr={abbr} color={color} />
    </button>
  );
}
