import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, QrCode, MapPin, CheckCircle, Truck, Package, ShoppingCart, AlertTriangle, ChevronRight, Download, Thermometer } from 'lucide-react'
import TripTrackingMap from '../map/TripTrackingMap.jsx'
import RiskBadge from '../ui/RiskBadge.jsx'
import ConfirmReceiptModal from './ConfirmReceiptModal.jsx'
import { traceabilityApi } from '../../api/traceability.js'
import { useAuth } from '../../context/AuthContext.jsx'
import toast from 'react-hot-toast'

// Phase 1 risk score — same ≥10% "high-risk" convention already used on the MINAGRI dashboard.
function riskFromLossPct(pct) {
  if (pct == null) return null
  if (pct >= 10) return 'RED'
  if (pct >= 5) return 'AMBER'
  return 'GREEN'
}

// Build supply chain timeline from full batch data
// Covers all five stages: Cooperative → Leg 1 Transit → Distributor → Leg 2 Transit → Market
function buildTimeline(batch) {
  const status = batch.current_status
  const hasLeg2 = !!(batch.transport_request_leg2)
  const leg2Active   = ['IN_TRANSIT_LEG2', 'AT_MARKET', 'COMPLETED'].includes(status)
  const marketDone   = ['AT_MARKET', 'COMPLETED'].includes(status)

  const steps = [
    // ── Stage 1: Cooperative dispatch ───────────────────────────────────
    {
      step: 'Dispatched from Cooperative',
      date: batch.dispatch_timestamp?.split('T')[0],
      location: batch.cooperative_name || 'Cooperative',
      detail: `${Number(batch.dispatch_weight_kg).toLocaleString()} kg · Grade ${batch.quality_grade_at_dispatch || '—'}`,
      status: 'done',
      icon: 'dispatch',
    },
    // ── Stage 2: Leg 1 — Cooperative to Distributor ─────────────────────
    {
      step: 'In Transit — Leg 1',
      date: null,
      location: 'En route to distributor',
      detail: batch.transport_request_leg1
        ? `Transport request #${batch.transport_request_leg1}`
        : 'No transporter assigned for this leg',
      status: status === 'AT_COOPERATIVE' ? 'pending'
            : status === 'IN_TRANSIT_LEG1' ? 'active'
            : 'done',
      icon: 'transit',
    },
    // ── Stage 3: Distributor receipt ─────────────────────────────────────
    {
      step: 'Received by Distributor',
      date: batch.distributor_receipt_timestamp?.split('T')[0],
      location: batch.distributor_name || 'Distributor warehouse',
      detail: batch.weight_at_distributor_kg
        ? `Received: ${Number(batch.weight_at_distributor_kg).toLocaleString()} kg · Grade ${batch.quality_at_distributor || '—'} · Transit loss: ${batch.transit_loss_leg1_pct ?? 0}%`
        : 'Awaiting receipt confirmation',
      status: ['AT_DISTRIBUTOR', 'IN_TRANSIT_LEG2', 'AT_MARKET', 'COMPLETED'].includes(status) ? 'done' : 'pending',
      icon: 'delivered',
    },
    // ── Stage 4: Leg 2 — Distributor to Market Agent (only if applicable) ─
    {
      step: 'In Transit — Leg 2',
      date: null,
      location: hasLeg2 ? 'En route to market agent' : 'Market agent self-collected',
      detail: hasLeg2
        ? (batch.transport_request_leg2
            ? `Transport request #${batch.transport_request_leg2}`
            : 'Transport arranged by distributor')
        : 'Market agent collected directly from distributor warehouse',
      status: !['IN_TRANSIT_LEG2', 'AT_MARKET', 'COMPLETED'].includes(status)
            ? 'pending'
            : status === 'IN_TRANSIT_LEG2' ? 'active'
            : 'done',
      icon: 'transit',
    },
    // ── Stage 5: Market agent receipt & retail ────────────────────────────
    {
      step: marketDone ? 'Received at Market' : 'At Market',
      date: batch.market_receipt_timestamp?.split('T')[0] || null,
      location: batch.market_agent_name ? `${batch.market_agent_name}'s stall` : 'Market stall',
      detail: marketDone
        ? [
            batch.weight_at_market_kg
              ? `Received: ${Number(batch.weight_at_market_kg).toLocaleString()} kg`
              : null,
            batch.market_spoilage_loss_pct != null
              ? `Market spoilage: ${batch.market_spoilage_loss_pct}%`
              : null,
            batch.total_loss_pct != null
              ? `Total end-to-end loss: ${batch.total_loss_pct}%`
              : null,
          ].filter(Boolean).join(' · ') || 'At market'
        : 'Awaiting delivery to market agent',
      status: marketDone ? 'done' : 'pending',
      icon: 'market',
    },
  ]

  return { steps, scans: batch.qr_scans ?? [] }
}

const iconByType = {
  dispatch: <Package className="w-4 h-4" />,
  transit: <Truck className="w-4 h-4" />,
  delivered: <CheckCircle className="w-4 h-4" />,
  market: <ShoppingCart className="w-4 h-4" />,
}

const stepColors = {
  done: { dot: 'bg-success-500 border-success-200 text-white', line: 'bg-success-200' },
  active: { dot: 'bg-primary-500 border-primary-200 text-white animate-pulse', line: 'bg-gray-200' },
  pending: { dot: 'bg-gray-200 border-gray-100 text-gray-400', line: 'bg-gray-100' },
}

const STATUS_LABEL = {
  AT_COOPERATIVE:   'At Cooperative',
  IN_TRANSIT_LEG1:  'In Transit (Leg 1)',
  AT_DISTRIBUTOR:   'At Distributor',
  IN_TRANSIT_LEG2:  'In Transit (Leg 2)',
  AT_MARKET:        'At Market',
  COMPLETED:        'Completed',
}

/**
 * Shared batch-traceability explorer: search by batch ID/QR, full supply-chain timeline,
 * QR label, and live location map. Used by both Cooperative and Distributor roles — the
 * backend's BatchViewSet already scopes the returned batches correctly per role.
 */
export default function TraceabilityExplorer({
  listTitle = 'Your batches',
  emptyListMessage = 'No batches yet',
  emptyListSubtext = '',
  initialBatch = null,   // if set, auto-opens this batch immediately on mount
}) {
  const { user } = useAuth()
  const [batches, setBatches] = useState([])
  const [loadingBatches, setLoadingBatches] = useState(true)

  const [query, setQuery] = useState('')
  const [batch, setBatch] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [searching, setSearching] = useState(false)
  const [qrUrl, setQrUrl] = useState(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [iotData, setIotData] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)

  useEffect(() => {
    traceabilityApi.getBatches()
      .then(res => setBatches(res.data?.results ?? res.data ?? []))
      .catch(() => toast.error('Could not load batches'))
      .finally(() => setLoadingBatches(false))
  }, [])

  // Fetch the QR code image whenever a batch is selected — revoke the previous
  // object URL first so we don't leak blobs as the user browses batches.
  useEffect(() => {
    setQrUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    if (!batch) return
    setLoadingQr(true)
    traceabilityApi.getQR(batch.id)
      .then(res => setQrUrl(URL.createObjectURL(res.data)))
      .catch(() => setQrUrl(null))
      .finally(() => setLoadingQr(false))
    return () => setQrUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }, [batch?.id])

  useEffect(() => {
    setIotData(null)
    if (!batch) return
    const fetchIot = () => traceabilityApi.getBatchIoT(batch.id).then(res => setIotData(res.data)).catch(() => {})
    // Also re-fetch the batch itself so current_status stays live
    // (e.g. transporter confirms delivery → IN_TRANSIT_LEG1 → AT_DISTRIBUTOR without page reload)
    const refreshBatch = () => traceabilityApi.getBatch(batch.id, { _silent: true })
      .then(res => setBatch(res.data)).catch(() => {})
    fetchIot()
    const interval = setInterval(() => { fetchIot(); refreshBatch() }, 10000)
    return () => clearInterval(interval)
  }, [batch?.id])

  // Guards against a stale response overwriting a newer selection — if the user clicks
  // batch A then quickly clicks batch B before A's request resolves, A's response (if it
  // lands after B's) must not clobber what's now on screen for B.
  const openRequestRef = useRef(0)

  const openBatch = async (item) => {
    const requestId = ++openRequestRef.current
    setBatch(null)
    setNotFound(false)
    setQuery('')
    try {
      const res = await traceabilityApi.getBatch(item.id, { _silent: true })
      if (requestId !== openRequestRef.current) return
      setBatch(res.data)
    } catch {
      if (requestId !== openRequestRef.current) return
      // silently fall back to list-level data so the timeline still renders
      setBatch(item)
    }
  }

  // Auto-open a batch passed in from the parent (e.g. "View route on map" from Active Batches).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialBatch) openBatch(initialBatch) }, [initialBatch?.id])

  // Deep link from a notification (e.g. a transporter's incident report) — ?batch=<id>
  // opens that batch directly instead of landing on the plain list.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const batchId = searchParams.get('batch')
    if (!batchId) return
    openBatch({ id: batchId })
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = async (e) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    // 1. Search the already-loaded batch list by crop name, cooperative name, or short ID first.
    //    This avoids sending a crop name (e.g. "Bananas") to the UUID-only QR lookup endpoint.
    const lower = q.toLowerCase()
    const localMatch = batches.find(b =>
      (b.crop_name || '').toLowerCase().includes(lower) ||
      (b.cooperative_name || '').toLowerCase().includes(lower) ||
      (b.batch_id_short || '').toLowerCase().startsWith(lower) ||
      (String(b.id) === q)
    )
    if (localMatch) { openBatch(localMatch); return }

    // 2. Fall back to QR/UUID lookup (for scanning or pasting a full batch UUID)
    setSearching(true)
    setBatch(null)
    setNotFound(false)
    try {
      const res = await traceabilityApi.lookupByQR(q)
      setBatch(res.data)
    } catch (err) {
      if (err.response?.status === 404) setNotFound(true)
      else setNotFound(true) // treat any API error as "not found" for this search
    } finally {
      setSearching(false)
    }
  }

  const timeline = batch ? buildTimeline(batch) : null

  const statusColor = (status) => {
    if (['AT_MARKET', 'COMPLETED'].includes(status)) return 'bg-success-50 text-success-600'
    if (['IN_TRANSIT_LEG1', 'IN_TRANSIT_LEG2'].includes(status)) return 'bg-primary-50 text-primary-600'
    if (status === 'AT_DISTRIBUTOR') return 'bg-success-50 text-success-500'
    return 'bg-warning-50 text-warning-500'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Traceability</h1>
        <p className="text-sm text-gray-500 mt-0.5">Track any batch through the supply chain from dispatch to market.</p>
      </div>

      {/* Search by batch ID */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="input pl-9"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by crop, cooperative, or batch ID…"
          />
        </div>
        <button type="submit" disabled={searching} className="btn-primary flex items-center gap-2 px-5 disabled:opacity-60">
          <QrCode className="w-4 h-4" /> {searching ? 'Searching…' : 'Trace'}
        </button>
      </form>

      {notFound && (
        <div className="card text-center py-10 text-gray-400">
          <QrCode className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Batch not found</p>
          <p className="text-sm mt-1">Check the batch ID and try again.</p>
        </div>
      )}

      {/* Timeline for selected/searched batch */}
      {batch && timeline && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-400 font-mono mb-1">{batch.batch_id || batch.batch_id_short}</p>
                <h2 className="text-xl font-bold text-gray-900">{batch.crop_name}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {Number(batch.dispatch_weight_kg).toLocaleString()} kg · Grade {batch.quality_grade_at_dispatch || '—'} · Dispatched {batch.dispatch_timestamp?.split('T')[0]}
                </p>
              </div>
              <div className="text-right text-sm text-gray-500">
                <p>{batch.cooperative_name}</p>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block ${statusColor(batch.current_status)}`}>
                  {STATUS_LABEL[batch.current_status] ?? batch.current_status?.replace(/_/g, ' ')}
                </span>
                {riskFromLossPct(batch.total_loss_pct) && (
                  <div className="mt-1.5">
                    <RiskBadge label={riskFromLossPct(batch.total_loss_pct)} score={`${batch.total_loss_pct}%`} />
                  </div>
                )}
              </div>
            </div>

            {(batch.transit_loss_leg1_pct > 0 || batch.total_loss_pct > 0) && (
              <div className="mt-3 p-3 bg-warning-50 rounded-lg flex items-start gap-2 text-sm text-warning-500">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Loss recorded: Leg 1 — {batch.transit_loss_leg1_pct ?? 0}%, Total — {batch.total_loss_pct ?? 0}%
                </span>
              </div>
            )}
          </div>

          <div className="card flex items-center gap-6">
            <div className="w-36 h-36 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {loadingQr ? (
                <span className="text-xs text-gray-400">Loading…</span>
              ) : qrUrl ? (
                <img src={qrUrl} alt={`QR code for batch ${batch.batch_id_short}`} className="w-full h-full object-contain" />
              ) : (
                <QrCode className="w-10 h-10 text-gray-300" />
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-gray-900">Batch QR Code</h2>
              <p className="text-sm text-gray-500 mt-1">
                Print and attach this code to the physical batch. Scanning it at each handover point (pickup, distributor receipt, market collection) records a tamper-evident traceability event.
              </p>
              {qrUrl && (
                <a
                  href={qrUrl}
                  download={`batch-${batch.batch_id_short || batch.id}-qr.png`}
                  className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-primary-500/80 hover:bg-primary-500 transition-colors"
                >
                  <Download className="w-4 h-4" /> Download QR Code
                </a>
              )}
            </div>
          </div>

          {iotData?.temperature_readings?.length > 0 && (() => {
            const latest = iotData.temperature_readings[0]
            const breachCount = iotData.temperature_readings.filter(r => r.is_breach).length
            return (
              <div className={`card flex items-center gap-5 ${latest.is_breach ? 'border-l-4 border-l-danger-500' : ''}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${latest.is_breach ? 'bg-danger-50' : 'bg-primary-50'}`}>
                  <Thermometer className={`w-5 h-5 ${latest.is_breach ? 'text-danger-600' : 'text-primary-600'}`} />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-gray-700">Cold-Chain Status</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    Vehicle reading as of {new Date(latest.timestamp).toLocaleString()}
                    {breachCount > 0 && <span className="text-danger-600 ml-1.5">· {breachCount} breach{breachCount > 1 ? 'es' : ''} this trip</span>}
                  </p>
                </div>
                <p className={`text-2xl font-bold flex-shrink-0 ${latest.is_breach ? 'text-danger-600' : 'text-success-600'}`}>{latest.temperature_celsius}°C</p>
              </div>
            )
          })()}

          {iotData?.route && (
            <div className="card">
              <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4" /> {iotData.is_live ? 'Live Location' : 'Delivery Route'}
              </h2>
              <TripTrackingMap route={iotData.route} gpsTracks={iotData.is_live ? iotData.gps_tracks : []} />
            </div>
          )}

          <div className="card">
            <h2 className="text-base font-semibold text-gray-700 mb-5">Supply chain journey</h2>
            <div className="space-y-0">
              {timeline.steps.map((ev, i) => {
                const c = stepColors[ev.status]
                const isLast = i === timeline.steps.length - 1
                return (
                  <div key={i} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${c.dot}`}>
                        {iconByType[ev.icon]}
                      </div>
                      {!isLast && <div className={`w-0.5 flex-1 my-1 ${c.line}`} style={{ minHeight: 24 }} />}
                    </div>
                    <div className="pb-5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`text-sm font-semibold ${ev.status === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>{ev.step}</p>
                        {ev.date && <span className="text-xs text-gray-400">{ev.date}</span>}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                        <MapPin className="w-3 h-3" /> {ev.location}
                      </div>
                      <p className="text-xs text-gray-500">{ev.detail}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {timeline.scans.length > 0 && (
            <div className="card">
              <h2 className="text-base font-semibold text-gray-700 mb-3">QR scan events</h2>
              <div className="space-y-2">
                {timeline.scans.map((scan, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm p-2 bg-gray-50 rounded-lg">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-1.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="font-medium text-gray-700">{scan.scan_point?.replace(/_/g, ' ')}</span>
                      <span className="text-gray-400 text-xs ml-2">{scan.scanned_by_name}</span>
                    </div>
                    <span className="text-xs text-gray-400">{new Date(scan.scanned_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batch.downstream_orders?.length > 0 && (() => {
            const totalAllocated = batch.downstream_orders.reduce((sum, o) => sum + Number(o.quantity_kg), 0)
            const agentCount = new Set(batch.downstream_orders.map(o => o.market_agent_name)).size
            return (
              <div className="card">
                <h2 className="text-base font-semibold text-gray-700 mb-1">Where this batch went</h2>
                <p className="text-xs text-gray-500 mb-3">
                  This batch became warehouse stock once received — {totalAllocated.toLocaleString()} kg of the {Number(batch.dispatch_weight_kg).toLocaleString()} kg dispatched
                  has been sold on to {agentCount} market agent{agentCount !== 1 ? 's' : ''} across {batch.downstream_orders.length} order{batch.downstream_orders.length !== 1 ? 's' : ''} so far.
                </p>
                <div className="space-y-1.5">
                  {batch.downstream_orders.map(o => (
                    <div key={o.order_id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-gray-700">{o.market_agent_name || 'Unknown agent'} <span className="text-gray-400">· order #{o.order_id}</span></span>
                      <span className="font-medium text-gray-900">{Number(o.quantity_kg).toLocaleString()} kg</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Distributor: Confirm Receipt CTA when produce has arrived — opens in place, no navigation */}
          {user?.role === 'DISTRIBUTOR' && batch?.current_status === 'AT_DISTRIBUTOR' && (
            <div className="card border-2 border-primary-200 bg-primary-50/40 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-primary-700">This batch has arrived at your facility</p>
                <p className="text-xs text-primary-600 mt-0.5">Record the received weight and quality to complete the handover.</p>
              </div>
              <button
                onClick={() => setConfirmTarget({
                  batch_id: batch.id,
                  batch_id_short: batch.batch_id_short,
                  cooperative_name: batch.cooperative_name,
                  crop_name: batch.crop_name,
                  ordered_qty_kg: batch.ordered_quantity_kg,
                  shipped_qty_kg: batch.dispatch_weight_kg,
                })}
                className="btn-primary flex-shrink-0 flex items-center gap-2 text-sm px-4 py-2">
                <CheckCircle className="w-4 h-4" /> Confirm Receipt
              </button>
            </div>
          )}

          {/* Distributor: still in transit — prompt to come back when it arrives */}
          {user?.role === 'DISTRIBUTOR' && batch?.current_status === 'IN_TRANSIT_LEG1' && (
            <div className="card border border-blue-200 bg-blue-50/40">
              <p className="text-xs text-blue-600 font-medium">
                Batch is still in transit. The map above shows its route{iotData?.is_live ? ' and current position' : ''}.
                Once it arrives, return here and click Confirm Receipt to record the handover.
              </p>
            </div>
          )}

          <button onClick={() => { setBatch(null); setQuery('') }} className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1">
            ← Back to all batches
          </button>
        </div>
      )}

      {/* Role-scoped batch list */}
      {!batch && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-700">{listTitle}</h2>
          {loadingBatches ? (
            <div className="card py-8 text-center text-gray-400 text-sm">Loading batches…</div>
          ) : batches.length === 0 ? (
            <div className="card py-12 text-center text-gray-400">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">{emptyListMessage}</p>
              {emptyListSubtext && <p className="text-sm mt-1">{emptyListSubtext}</p>}
            </div>
          ) : (
            batches.map(b => (
              <button
                key={b.id}
                onClick={() => openBatch(b)}
                className="card w-full text-left hover:shadow-md transition-shadow flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <Package className="w-5 h-5 text-primary-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">
                      {b.crop_name} <span className="text-gray-400 font-normal text-sm">· {Number(b.dispatch_weight_kg).toLocaleString()} kg</span>
                    </p>
                    <p className="text-xs font-mono text-gray-400 mt-0.5">{b.batch_id_short}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full inline-block ${statusColor(b.current_status)}`}>
                      {STATUS_LABEL[b.current_status] ?? b.current_status?.replace(/_/g, ' ')}
                    </span>
                    <p className="text-xs text-gray-400 mt-0.5">{b.dispatch_timestamp?.split('T')[0]}</p>
                  </div>
                  {b.total_loss_pct > 0 && (
                    <span className="text-xs text-warning-500 bg-warning-50 px-2 py-0.5 rounded-full">
                      {b.total_loss_pct}% loss
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-300" />
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <ConfirmReceiptModal
        target={confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirmed={() => {
          setConfirmTarget(null)
          // Re-fetch so the timeline/status card reflects the handover immediately,
          // in place — no navigation away from the batch the distributor was looking at.
          if (batch) traceabilityApi.getBatch(batch.id, { _silent: true }).then(res => setBatch(res.data)).catch(() => {})
        }}
      />
    </div>
  )
}
