-- Bake the static visualization's data file from the genomic-dict parquets.
-- Run with:
--   duckdb -c ".read static/prepare_data.sql"
-- from the genomic-regions repo root, with the parquets at PARQUET_DIR.
-- Output is `static/data/cdh1.js` (a JS shim that sets window.STATIC_DATA so
-- the page works under file:// without CORS) plus the parallel
-- `static/data/cdh1.json` for inspection.

SET VARIABLE PARQUET_DIR = '/Users/sam/Documents/Work/spatial-region-features/genomic-dict/data/precomputed';
SET VARIABLE ANCHOR_TOKEN = 274120;        -- CDH1 PLS, chr16:68737071-68737417
SET VARIABLE STRATUM = 'corpus_baseline';  -- full corpus
SET VARIABLE TOP_N = 30;
SET VARIABLE WIN_2MB_HALF = 1000000;       -- 2 Mb total
SET VARIABLE WIN_20KB_HALF = 10000;        -- 20 kb total
SET VARIABLE CHR16_END = 90338345;

CREATE OR REPLACE TEMP VIEW _anchor AS
  SELECT *
  FROM read_parquet(getvariable('PARQUET_DIR') || '/viz_chr16.parquet')
  WHERE token_id = getvariable('ANCHOR_TOKEN');

CREATE OR REPLACE TEMP VIEW _partners AS
  WITH cooc AS (
    SELECT
      UNNEST(partner_token_ids) AS partner_token_id,
      UNNEST(weights_npmi) AS npmi,
      UNNEST(counts) AS cooc_count,
      GENERATE_SUBSCRIPTS(partner_token_ids, 1) AS rank
    FROM read_parquet(getvariable('PARQUET_DIR') || '/region_cooccurrence_pmi.parquet')
    WHERE token_id = getvariable('ANCHOR_TOKEN')
      AND stratum = getvariable('STRATUM')
  )
  SELECT
    c.rank, c.npmi, c.cooc_count,
    v.token_id, v.region, v.cclass, v.start, v."end", v.umap_x, v.umap_y
  FROM cooc c
  JOIN read_parquet(getvariable('PARQUET_DIR') || '/viz_chr16.parquet') v
    ON v.token_id = c.partner_token_id
  WHERE c.rank <= getvariable('TOP_N');

-- Single-row JSON object holding everything the page needs.
CREATE OR REPLACE TEMP VIEW _payload AS
  SELECT json_object(
    'meta', json_object(
      'anchor_token', getvariable('ANCHOR_TOKEN'),
      'stratum',      getvariable('STRATUM'),
      'top_n',        getvariable('TOP_N'),
      'chr16_end',    getvariable('CHR16_END'),
      'win_2mb_half', getvariable('WIN_2MB_HALF'),
      'win_20kb_half',getvariable('WIN_20KB_HALF')
    ),
    'anchor', (
      SELECT json_object(
        'token_id', token_id, 'region', region, 'cclass', cclass,
        'start', start, 'end', "end",
        'umap_x', umap_x, 'umap_y', umap_y
      ) FROM _anchor
    ),
    'partners', (
      SELECT json_group_array(json_object(
        'rank', rank, 'npmi', ROUND(npmi::DOUBLE, 4), 'count', cooc_count,
        'token_id', token_id, 'region', region, 'cclass', cclass,
        'start', start, 'end', "end",
        'umap_x', umap_x, 'umap_y', umap_y
      ))
      FROM (SELECT * FROM _partners ORDER BY rank) p
    ),
    'cloud', (
      SELECT json_group_array(json_object(
        'x', umap_x, 'y', umap_y, 'c', cclass
      ))
      FROM (
        SELECT umap_x, umap_y, cclass
        FROM read_parquet(getvariable('PARQUET_DIR') || '/viz_chr16.parquet')
        USING SAMPLE 3000
      ) c
    ),
    -- Sparse density for the chr16-full ribbon: bin region starts into
    -- 250 buckets so the static can render a faint background frequency
    -- rug behind the partner ticks.
    'chr_density', (
      SELECT json_group_array(json_object('b', bin, 'n', n))
      FROM (
        SELECT
          CAST(start * 250 / getvariable('CHR16_END') AS INT) AS bin,
          COUNT(*) AS n
        FROM read_parquet(getvariable('PARQUET_DIR') || '/viz_chr16.parquet')
        GROUP BY 1 ORDER BY 1
      ) d
    ),
    -- Local context: every region within ±1 Mb of the anchor (for the
    -- 2 Mb track) and every region within ±10 kb (for the 20 kb track).
    -- These are small so we ship them whole.
    'local_2mb', (
      SELECT json_group_array(json_object(
        'token_id', v.token_id, 'cclass', v.cclass,
        'start', v.start, 'end', v."end"
      ))
      FROM read_parquet(getvariable('PARQUET_DIR') || '/viz_chr16.parquet') v, _anchor a
      WHERE v.start BETWEEN (a.start + (a."end" - a.start)/2) - getvariable('WIN_2MB_HALF')
                        AND (a.start + (a."end" - a.start)/2) + getvariable('WIN_2MB_HALF')
    ),
    'local_20kb', (
      SELECT json_group_array(json_object(
        'token_id', v.token_id, 'cclass', v.cclass,
        'start', v.start, 'end', v."end"
      ))
      FROM read_parquet(getvariable('PARQUET_DIR') || '/viz_chr16.parquet') v, _anchor a
      WHERE v.start BETWEEN (a.start + (a."end" - a.start)/2) - getvariable('WIN_20KB_HALF')
                        AND (a.start + (a."end" - a.start)/2) + getvariable('WIN_20KB_HALF')
    )
  ) AS j
  FROM (SELECT 1) _;

-- Plain JSON for inspection.
COPY _payload TO 'static/data/cdh1.json' (FORMAT csv, HEADER false, QUOTE '', DELIMITER E'\t');

-- JS shim so the page works under file:// without CORS.
COPY (SELECT 'window.STATIC_DATA = ' || j || ';' AS line FROM _payload)
  TO 'static/data/cdh1.js' (FORMAT csv, HEADER false, QUOTE '', DELIMITER E'\t');
