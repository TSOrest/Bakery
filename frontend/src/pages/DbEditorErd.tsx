/**
 * SVG-діаграма зв'язків між таблицями БД.
 * Відкривається кнопкою "Схема БД" у редакторі бази даних.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────────

interface Column {
  name: string; type: string; is_pk: boolean
  not_null: boolean; default: string | null; cid: number
}
interface ForeignKey {
  from_col: string; to_table: string; to_col: string
  on_update: string; on_delete: string
}
interface SchemaInfo {
  table: string
  columns: Column[]
  foreign_keys: ForeignKey[]
  indexes: { name: string; unique: boolean; columns: string[] }[]
  ddl: string
}
interface TableInfo { name: string; row_count: number }

// ── Layout constants ───────────────────────────────────────────────────────

const TW     = 220   // table box width
const TH     = 34    // table header height
const RH     = 20    // column row height
const PAD_X  = 80    // horizontal gap between columns
const PAD_Y  = 40    // vertical gap between tables in same column
const N_COLS = 5     // target number of columns

interface TableLayout {
  name: string; schema: SchemaInfo; rowCount: number
  x: number; y: number; height: number
}

interface Edge {
  id: string; fromTable: string; toTable: string
  x1: number; y1: number; x2: number; y2: number
  cx1: number; cy1: number; cx2: number; cy2: number
}

// ── Layout algorithm ───────────────────────────────────────────────────────

function buildLayouts(tables: TableInfo[], schemas: Record<string, SchemaInfo>): TableLayout[] {
  const items = tables
    .filter(t => schemas[t.name])
    .map(t => ({
      name: t.name,
      schema: schemas[t.name],
      rowCount: t.row_count,
      h: TH + schemas[t.name].columns.length * RH + 2,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Shortest-column-first distribution
  const cols: typeof items[] = Array.from({ length: N_COLS }, () => [])
  const colH = new Array<number>(N_COLS).fill(0)
  for (const item of items) {
    const c = colH.indexOf(Math.min(...colH))
    cols[c].push(item)
    colH[c] += item.h + PAD_Y
  }

  const layouts: TableLayout[] = []
  for (let c = 0; c < N_COLS; c++) {
    let y = 20
    const x = c * (TW + PAD_X)
    for (const item of cols[c]) {
      layouts.push({ name: item.name, schema: item.schema, rowCount: item.rowCount, x, y, height: item.h })
      y += item.h + PAD_Y
    }
  }
  return layouts
}

function buildEdges(layouts: TableLayout[]): Edge[] {
  const map = new Map(layouts.map(l => [l.name, l]))
  const edges: Edge[] = []

  for (const tl of layouts) {
    for (const fk of tl.schema.foreign_keys) {
      const target = map.get(fk.to_table)
      if (!target || target.name === tl.name) continue

      const fromColIdx = tl.schema.columns.findIndex(c => c.name === fk.from_col)
      const toColIdx   = target.schema.columns.findIndex(c => c.name === fk.to_col)

      const y1 = tl.y + TH + (fromColIdx >= 0 ? fromColIdx * RH + RH / 2 : TH / 2)
      const y2 = target.y + TH + (toColIdx   >= 0 ? toColIdx   * RH + RH / 2 : TH / 2)

      let x1: number, x2: number, cx1: number, cx2: number
      if (target.x >= tl.x) {
        // target is to the right
        x1 = tl.x + TW; x2 = target.x
        const d = Math.max((x2 - x1) / 2, 50)
        cx1 = x1 + d; cx2 = x2 - d
      } else {
        // target is to the left
        x1 = tl.x; x2 = target.x + TW
        const d = Math.max((x1 - x2) / 2, 50)
        cx1 = x1 - d; cx2 = x2 + d
      }

      edges.push({
        id: `${tl.name}.${fk.from_col}->${fk.to_table}.${fk.to_col}`,
        fromTable: tl.name, toTable: fk.to_table,
        x1, y1, x2, y2, cx1, cy1: y1, cx2, cy2: y2,
      })
    }
  }
  return edges
}

// ── Color groups ───────────────────────────────────────────────────────────

const TABLE_COLOR: Record<string, string> = {
  categories: '#2980b9', units: '#2980b9', routes: '#2980b9',
  ingredients: '#2980b9', finance_articles: '#2980b9',
  clients: '#27ae60', products: '#27ae60', users: '#27ae60',
  orders: '#e67e22', invoices: '#e67e22', invoice_lines: '#e67e22',
  baking_tasks: '#e67e22',
  prices: '#8e44ad', client_price_overrides: '#8e44ad', finances: '#8e44ad',
  shop_counts: '#16a085', other_products: '#16a085', other_stock_in: '#16a085',
  daily_balances: '#16a085', movements: '#16a085',
  client_bot_users: '#c0392b', route_cancellations: '#c0392b', cancellation_lines: '#c0392b',
  product_ingredients: '#7f8c8d', auth_sessions: '#7f8c8d', settings: '#7f8c8d',
}
const DEF_COLOR = '#546e7a'

const LEGEND: [string, string][] = [
  ['Довідники',  '#2980b9'],
  ['Ентитети',   '#27ae60'],
  ['Операційні', '#e67e22'],
  ['Фінанси',    '#8e44ad'],
  ['Магазин',    '#16a085'],
  ['Бот/скас.',  '#c0392b'],
  ['Решта',      '#7f8c8d'],
]

// ── Component ──────────────────────────────────────────────────────────────

export default function ErdView({ onClose }: { onClose: () => void }) {
  const { token } = useAuth()
  const [tables,    setTables]  = useState<TableInfo[]>([])
  const [schemas,   setSchemas] = useState<Record<string, SchemaInfo>>({})
  const [loaded,    setLoaded]  = useState(0)
  const [total,     setTotal]   = useState(0)
  const [fetchErr,  setFetchErr] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)

  // Viewport: x/y offset + w/h for zoom
  const [vb, setVb] = useState({ x: 0, y: 0, w: 1600, h: 900 })
  const svgRef = useRef<SVGSVGElement>(null)
  const panning = useRef(false)
  const panOrigin = useRef({ mx: 0, my: 0, vx: 0, vy: 0 })

  const apiFetch = useCallback(async (path: string) => {
    const res = await fetch(`/api/v1/db-editor${path}`, {
      headers: { 'Authorization': `Bearer ${token ?? ''}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [token])

  // Fetch all table schemas in parallel
  useEffect(() => {
    apiFetch('/tables').then(async (tbls: TableInfo[]) => {
      setTables(tbls)
      setTotal(tbls.length)
      const acc: Record<string, SchemaInfo> = {}
      await Promise.all(tbls.map(t =>
        apiFetch(`/tables/${t.name}/schema`)
          .then(s => { acc[t.name] = s; setLoaded(n => n + 1) })
          .catch(() => setLoaded(n => n + 1))
      ))
      setSchemas(acc)
    }).catch(e => setFetchErr(String(e)))
  }, [apiFetch])

  const layouts = useMemo(() => buildLayouts(tables, schemas), [tables, schemas])
  const edges   = useMemo(() => buildEdges(layouts), [layouts])

  const svgW = layouts.length > 0 ? Math.max(...layouts.map(l => l.x + TW)) + PAD_X : 1600
  const svgH = layouts.length > 0 ? Math.max(...layouts.map(l => l.y + l.height)) + PAD_Y : 900

  // Set initial viewbox once layouts are ready
  const inited = useRef(false)
  useEffect(() => {
    if (layouts.length > 0 && !inited.current) {
      inited.current = true
      setVb({ x: 0, y: 0, w: svgW, h: svgH })
    }
  }, [layouts, svgW, svgH])

  // Tables related to highlighted
  const related = useMemo(() => {
    if (!highlighted) return new Set<string>()
    const s = new Set([highlighted])
    for (const e of edges) {
      if (e.fromTable === highlighted) s.add(e.toTable)
      if (e.toTable   === highlighted) s.add(e.fromTable)
    }
    return s
  }, [highlighted, edges])

  // Pan/zoom handlers
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    panning.current = true
    panOrigin.current = { mx: e.clientX, my: e.clientY, vx: vb.x, vy: vb.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!panning.current || !svgRef.current) return
    const scale = vb.w / svgRef.current.clientWidth
    setVb(v => ({
      ...v,
      x: panOrigin.current.vx - (e.clientX - panOrigin.current.mx) * scale,
      y: panOrigin.current.vy - (e.clientY - panOrigin.current.my) * scale,
    }))
  }
  const stopPan = () => { panning.current = false }
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const f = e.deltaY > 0 ? 1.12 : 0.89
    setVb(v => ({
      ...v,
      w: Math.max(300, Math.min(8000, v.w * f)),
      h: Math.max(200, Math.min(6000, v.h * f)),
    }))
  }

  const isDone = total > 0 && loaded >= total

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1a2e', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', background: '#0f0f1a', borderBottom: '1px solid #333', flexShrink: 0 }}>
        <span style={{ color: 'white', fontWeight: 600 }}>🗄 Схема бази даних</span>
        {!isDone
          ? <span style={{ color: '#aaa', fontSize: '0.82rem' }}>Завантаження {loaded}/{total}...</span>
          : <span style={{ color: '#7f8', fontSize: '0.82rem' }}>{layouts.length} таблиць · {edges.length} FK-зв'язків</span>
        }
        <span style={{ marginLeft: 'auto', color: '#777', fontSize: '0.78rem' }}>
          Колесо — zoom · Перетягти — pan · Клік — підсвітити зв'язки · Клік на тлі — скинути
        </span>
        <button
          onClick={onClose}
          style={{ padding: '3px 10px', background: '#333', color: '#ddd', border: '1px solid #555', borderRadius: 4, cursor: 'pointer' }}
        >✕ Закрити</button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, padding: '4px 14px', background: '#0c0c18', borderBottom: '1px solid #222', flexShrink: 0, flexWrap: 'wrap' }}>
        {LEGEND.map(([label, color]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#bbb', fontSize: '0.75rem' }}>
            <span style={{ width: 11, height: 11, background: color, borderRadius: 2, display: 'inline-block', flexShrink: 0 }} />
            {label}
          </span>
        ))}
      </div>

      {fetchErr && <div style={{ color: '#e74c3c', padding: '0.5rem 1rem', fontSize: '0.85rem' }}>Помилка: {fetchErr}</div>}

      {/* SVG canvas */}
      <svg
        ref={svgRef}
        style={{ flex: 1, width: '100%', userSelect: 'none' }}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
        onWheel={onWheel}
      >
        <defs>
          <marker id="erd-arr"    markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#888" />
          </marker>
          <marker id="erd-arr-hi" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#f39c12" />
          </marker>
        </defs>

        {/* Transparent background for click-to-deselect */}
        <rect x={-99999} y={-99999} width={199999} height={199999} fill="transparent"
          onClick={() => setHighlighted(null)} style={{ cursor: 'default' }} />

        {/* FK edges (rendered before tables so they go under) */}
        {edges.map(e => {
          const isHi  = highlighted ? (e.fromTable === highlighted || e.toTable === highlighted) : false
          const dim   = !!(highlighted && !isHi)
          return (
            <path
              key={e.id}
              d={`M${e.x1},${e.y1} C${e.cx1},${e.cy1} ${e.cx2},${e.cy2} ${e.x2},${e.y2}`}
              stroke={isHi ? '#f39c12' : '#777'}
              strokeWidth={isHi ? 2 : 1}
              fill="none"
              opacity={dim ? 0.08 : isHi ? 0.9 : 0.55}
              markerEnd={isHi ? 'url(#erd-arr-hi)' : 'url(#erd-arr)'}
              style={{ pointerEvents: 'none' }}
            />
          )
        })}

        {/* Table boxes */}
        {layouts.map(tl => {
          const color  = TABLE_COLOR[tl.name] ?? DEF_COLOR
          const isHi   = highlighted === tl.name
          const isRel  = related.has(tl.name)
          const dim    = !!(highlighted && !isRel)
          const fkCols = new Set(tl.schema.foreign_keys.map(f => f.from_col))

          return (
            <g
              key={tl.name}
              transform={`translate(${tl.x},${tl.y})`}
              onClick={e => { e.stopPropagation(); setHighlighted(h => h === tl.name ? null : tl.name) }}
              style={{ cursor: 'pointer' }}
              opacity={dim ? 0.2 : 1}
            >
              {/* Body */}
              <rect width={TW} height={tl.height} fill="#f5f6fa"
                stroke={isHi ? '#f39c12' : isRel ? '#aaa' : '#ccc'}
                strokeWidth={isHi ? 2.5 : 1} rx={4} />

              {/* Header */}
              <rect width={TW} height={TH} fill={color} rx={4} />
              {/* Square off bottom corners of header */}
              <rect y={TH - 6} width={TW} height={6} fill={color} />

              <text x={7} y={TH - 10} fill="white" fontSize={12} fontWeight="bold"
                fontFamily="'Consolas','Courier New',monospace">
                {tl.name}
              </text>
              <text x={TW - 6} y={TH - 10} fill="rgba(255,255,255,0.6)" fontSize={9.5}
                textAnchor="end" fontFamily="'Consolas','Courier New',monospace">
                {tl.rowCount} rows
              </text>

              {/* Column rows */}
              {tl.schema.columns.map((col, i) => {
                const rowY  = TH + i * RH
                const isPk  = col.is_pk
                const isFk  = fkCols.has(col.name)
                const isUniq = tl.schema.indexes.some(ix => ix.unique && ix.columns.includes(col.name))

                return (
                  <g key={col.name}>
                    {i % 2 === 0 && (
                      <rect y={rowY} width={TW} height={RH} fill="rgba(0,0,0,0.035)" />
                    )}
                    {/* Column badge */}
                    {(isPk || isFk || isUniq) && (
                      <rect x={5} y={rowY + 4} width={isPk ? 16 : 14} height={13} rx={2}
                        fill={isPk ? '#2471a3' : isFk ? '#d35400' : '#1e8449'} opacity={0.15} />
                    )}
                    <text x={isPk || isFk || isUniq ? 6 : 6} y={rowY + 14.5}
                      fontSize={10}
                      fontFamily="'Consolas','Courier New',monospace"
                      fill={isPk ? '#1a5276' : isFk ? '#7d3c00' : '#2c3e50'}
                      fontWeight={isPk || isFk ? 600 : 400}
                    >
                      {isPk ? 'PK' : isFk ? 'FK' : isUniq ? 'U ' : '  '}
                    </text>
                    <text x={26} y={rowY + 14.5}
                      fontSize={10}
                      fontFamily="'Consolas','Courier New',monospace"
                      fill={isPk ? '#1a5276' : isFk ? '#7d3c00' : '#2c3e50'}
                      fontWeight={isPk || isFk ? 600 : 400}
                    >
                      {col.name}
                    </text>
                    <text x={TW - 5} y={rowY + 14.5} fontSize={9} textAnchor="end"
                      fill="#999" fontFamily="'Consolas','Courier New',monospace">
                      {col.type
                        .replace('AUTOINCREMENT', '')
                        .replace('INTEGER', 'INT')
                        .trim()}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
