import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, AlertTriangle, CheckCircle, Thermometer, MapPin, Truck, Package, FlagTriangleRight } from 'lucide-react'
import Modal from '../../components/ui/Modal.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import TripTrackingMap from '../../components/map/TripTrackingMap.jsx'
import ConfirmReceiptModal from '../../components/traceability/ConfirmReceiptModal.jsx'
import { distributionApi } from '../../api/distribution.js'
import { traceabilityApi } from '../../api/traceability.js'
import toast from 'react-hot-toast'

const GRADE_OPTIONS = ['A', 'B', 'C']
const FILTER_OPTIONS = ['ALL', 'IN_TRANSIT', 'CONFIRMED']
const FILTER_LABEL = { ALL: 'All', IN_TRANSIT: 'In Transit', CONFIRMED: 'Confirmed' }

function mapBatch(b) {
  return {
    id: b.id,
    batch_id: b.id,
    batch_id_short: b.batch_id_short,
    cooperative_name: b.cooperative_name,
    crop_name: b.crop_name,
    ordered_qty_kg: b.ordered_quantity_kg,
    shipped_qty_kg: b.dispatch_weight_kg,
    eta: b.dispatch_timestamp,
    status: b.current_status === 'AT_DISTRIBUTOR' ? 'CONFIRMED' : 'IN_TRANSIT',
    // Batches sharing the same transport_request_leg1 physically arrived together on one
    // trip (the cooperative's "share a trip with other batches" dispatch option) — group
    // them so the distributor can confirm the whole delivery in one action instead of
    // clicking "Confirm Receipt" once per crop.
    transport_request_leg1: b.transport_request_leg1,
    mismatch_reported: b.mismatch_reported,
    mismatch_description: b.mismatch_description,
  }
}

export default function IncomingDeliveries() {
  const [deliveries, setDeliveries] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('ALL')
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [iotTarget, setIotTarget] = useState(null)
  const [iotData, setIotData] = useState(null)
  const [loadingIot, setLoadingIot] = useState(false)
  const [bulkGroup, setBulkGroup] = useState(null)       // array of deliveries sharing one trip
  const [bulkForms, setBulkForms] = useState({})         // { [deliveryId]: { received_qty_kg, quality_grade_received, loss_reason } }
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [mismatchTarget, setMismatchTarget] = useState(null)
  const [mismatchForm, setMismatchForm] = useState({ description: '', notes: '' })
  const [mismatchSaving, setMismatchSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await traceabilityApi.getBatches()
      const list = res.data?.results ?? res.data ?? []
      setDeliveries(
        list
          .filter(b => ['IN_TRANSIT_LEG1', 'AT_DISTRIBUTOR'].includes(b.current_status))
          .map(mapBatch)
      )
    } catch {
      toast.error('Could not load incoming deliveries')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openIot = async (delivery) => {
    setIotTarget(delivery)
    setIotData(null)
    setLoadingIot(true)
    try {
      const res = await traceabilityApi.getBatchIoT(delivery.batch_id)
      setIotData(res.data)
    } catch {
      setIotData({ temperature_readings: [], gps_tracks: [] })
    } finally {
      setLoadingIot(false)
    }
  }

  const openConfirm = (delivery) => setConfirmTarget(delivery)

  const openMismatch = (delivery) => {
    setMismatchTarget(delivery)
    setMismatchForm({ description: '', notes: '' })
  }

  const submitMismatch = async (e) => {
    e.preventDefault()
    if (!mismatchTarget) return
    if (!mismatchForm.description.trim()) { toast.error('Describe what was actually received.'); return }
    setMismatchSaving(true)
    try {
      await traceabilityApi.reportMismatch(mismatchTarget.batch_id, mismatchForm)
      setDeliveries(prev => prev.map(d => d.id === mismatchTarget.id
        ? { ...d, mismatch_reported: true, mismatch_description: mismatchForm.description }
        : d))
      toast.success('Mismatch reported to the cooperative')
      setMismatchTarget(null)
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not report mismatch')
    } finally {
      setMismatchSaving(false)
    }
  }

  const handleConfirmed = () => {
    setDeliveries(prev => prev.map(d => d.id === confirmTarget.id ? { ...d, status: 'CONFIRMED' } : d))
    setConfirmTarget(null)
  }

  const filtered = filter === 'ALL' ? deliveries : deliveries.filter(d => d.status === filter)

  const inTransitCount = deliveries.filter(d => d.status === 'IN_TRANSIT').length
  const deliveredCount = deliveries.filter(d => d.status === 'DELIVERED').length

  // Group pending (IN_TRANSIT) deliveries by shared trip — these arrived together physically.
  const sharedTripGroups = useMemo(() => {
    const byTrip = {}
    deliveries
      .filter(d => d.status === 'IN_TRANSIT' && d.transport_request_leg1)
      .forEach(d => {
        byTrip[d.transport_request_leg1] = byTrip[d.transport_request_leg1] || []
        byTrip[d.transport_request_leg1].push(d)
      })
    return Object.values(byTrip).filter(group => group.length > 1)
  }, [deliveries])

  const openBulkConfirm = (group) => {
    setBulkGroup(group)
    setBulkNotes('')
    const forms = {}
    group.forEach(d => {
      forms[d.id] = {
        received_qty_kg: d.shipped_qty_kg,
        quality_grade_received: 'A',
        shortfall_type: '',
        transit_loss_reason: '',
        not_dispatched_reason: '',
      }
    })
    setBulkForms(forms)
  }

  const bulkLoss = (d) => {
    const received = Number(bulkForms[d.id]?.received_qty_kg) || 0
    const shipped = Number(d.shipped_qty_kg) || 0
    const lossKg = Math.max(0, shipped - received)
    const lossPct = shipped > 0 ? ((lossKg / shipped) * 100).toFixed(1) : '0.0'
    return { lossKg, lossPct }
  }

  const handleBulkConfirm = async (e) => {
    e.preventDefault()
    if (!bulkGroup) return
    setBulkSaving(true)
    const targets = bulkGroup
    const results = await Promise.allSettled(targets.map(d => {
      const form = bulkForms[d.id]
      const { lossKg, lossPct } = bulkLoss(d)
      let loss_reason = ''
      if (lossKg > 0) {
        if (form.shortfall_type === 'TRANSIT_LOSS') {
          loss_reason = `IN_TRANSIT: ${form.transit_loss_reason}`
        } else if (form.shortfall_type === 'NOT_DISPATCHED') {
          loss_reason = `NOT_DISPATCHED: ${form.not_dispatched_reason} — ${lossKg}kg of ${d.crop_name} not sent by cooperative`
        }
      }
      return distributionApi.confirmReceipt(d.batch_id, {
        received_qty_kg: Number(form.received_qty_kg) || 0,
        quality_grade_received: form.quality_grade_received,
        loss_kg: lossKg,
        loss_pct: parseFloat(lossPct),
        loss_reason,
        shortfall_type: form.shortfall_type || null,
        notes: bulkNotes,
      })
    }))
    const succeeded = targets.filter((_, i) => results[i].status === 'fulfilled')
    const failedCount = targets.length - succeeded.length
    if (succeeded.length > 0) {
      const ids = new Set(succeeded.map(d => d.id))
      setDeliveries(prev => prev.map(d => ids.has(d.id) ? { ...d, status: 'CONFIRMED' } : d))
    }
    if (failedCount === 0) {
      toast.success(`Confirmed ${targets.length} batches from this delivery`)
    } else if (succeeded.length === 0) {
      toast.error(`Failed to confirm ${failedCount} batch${failedCount > 1 ? 'es' : ''}`)
    } else {
      toast.error(`Confirmed ${succeeded.length} batches, ${failedCount} failed`)
    }
    setBulkSaving(false)
    setBulkGroup(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Incoming Deliveries</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track produce batches on the way to your warehouse.</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 border border-gray-200 disabled:opacity-40">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary pills */}
      {(inTransitCount > 0 || deliveredCount > 0) && (
        <div className="flex gap-3 flex-wrap">
          {inTransitCount > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-sm font-semibold text-blue-700">
              {inTransitCount} in transit
            </div>
          )}
          {deliveredCount > 0 && (
            <div className="bg-warning-50 border border-warning-200 rounded-xl px-4 py-2 text-sm font-semibold text-warning-700">
              {deliveredCount} awaiting confirmation
            </div>
          )}
        </div>
      )}

      {/* Shared-trip groups — batches that physically arrived together */}
      {sharedTripGroups.length > 0 && (
        <div className="space-y-2">
          {sharedTripGroups.map(group => (
            <div key={group[0].transport_request_leg1} className="flex items-center justify-between bg-primary-50 border border-primary-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <Truck className="w-4 h-4 text-primary-600 flex-shrink-0" />
                <p className="text-sm text-primary-800">
                  <span className="font-semibold">{group.length} batches</span> from {group[0].cooperative_name} arrived on the same trip
                  {' — '}{group.map(d => d.crop_name).join(', ')}
                </p>
              </div>
              <button onClick={() => openBulkConfirm(group)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-semibold text-white bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 transition-colors flex-shrink-0">
                <Package className="w-3.5 h-3.5" /> Confirm All ({group.length})
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {FILTER_OPTIONS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${filter === f ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              {['Batch ID', 'Cooperative', 'Crop', 'Shipped Qty', 'ETA', 'Status', 'Action'].map(h => (
                <th key={h} className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No deliveries in this category.</td></tr>
            ) : (
              filtered.map(d => (
                <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-sm font-medium text-gray-900">{d.batch_id || d.id}</td>
                  <td className="px-6 py-4 text-gray-700">{d.cooperative_name || '—'}</td>
                  <td className="px-6 py-4 text-gray-700">
                    {d.crop_name || '—'}
                    {d.mismatch_reported && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-danger-50 text-danger-600 border border-danger-200">
                        <FlagTriangleRight className="w-3 h-3" /> Mismatch reported
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-900 font-medium">
                    {d.shipped_qty_kg ? `${Number(d.shipped_qty_kg).toLocaleString()} kg` : '—'}
                  </td>
                  <td className="px-6 py-4 text-gray-500">
                    {d.eta ? new Date(d.eta).toLocaleDateString('en-RW', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={d.status} /></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {d.status === 'IN_TRANSIT' && (
                        <>
                          <button onClick={() => openIot(d)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors">
                            <Thermometer className="w-3.5 h-3.5" /> Live Data
                          </button>
                          <button onClick={() => openConfirm(d)}
                            className="inline-flex items-center px-4 py-1.5 rounded-xl text-sm font-semibold text-white bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 transition-colors">
                            Confirm Receipt
                          </button>
                          {!d.mismatch_reported && (
                            <button onClick={() => openMismatch(d)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-danger-600 border border-danger-200 hover:bg-danger-50 transition-colors">
                              <FlagTriangleRight className="w-3.5 h-3.5" /> Report Mismatch
                            </button>
                          )}
                        </>
                      )}
                      {d.status === 'CONFIRMED' && (
                        <span className="text-xs text-success-600 flex items-center gap-1 font-medium">
                          <CheckCircle className="w-3.5 h-3.5" /> Confirmed
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Confirm Receipt Modal */}
      <ConfirmReceiptModal target={confirmTarget} onClose={() => setConfirmTarget(null)} onConfirmed={handleConfirmed} />

      {/* Bulk Confirm Receipt Modal — batches that arrived together on one trip */}
      <Modal isOpen={!!bulkGroup} onClose={() => setBulkGroup(null)}
        title={`Confirm Whole Delivery — ${bulkGroup?.length || 0} batches`}>
        {bulkGroup && (
          <form onSubmit={handleBulkConfirm} className="space-y-4">
            <p className="text-sm text-gray-500">
              These batches arrived on the same trip from {bulkGroup[0].cooperative_name}. Enter what was actually received for each, then confirm them all at once.
            </p>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {bulkGroup.map(d => {
                const form = bulkForms[d.id] || {}
                const { lossKg, lossPct } = bulkLoss(d)
                return (
                  <div key={d.id} className="border border-gray-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-900">{d.crop_name}</span>
                      <span className="text-gray-400 text-xs">Expected {Number(d.shipped_qty_kg).toLocaleString()} kg</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label text-xs">Received qty (kg) *</label>
                        <input type="number" className="input" required min="0"
                          value={form.received_qty_kg ?? ''}
                          onChange={e => setBulkForms(prev => ({ ...prev, [d.id]: { ...prev[d.id], received_qty_kg: e.target.value } }))} />
                      </div>
                      <div>
                        <label className="label text-xs">Quality grade</label>
                        <select className="input" value={form.quality_grade_received}
                          onChange={e => setBulkForms(prev => ({ ...prev, [d.id]: { ...prev[d.id], quality_grade_received: e.target.value } }))}>
                          {GRADE_OPTIONS.map(g => <option key={g} value={g}>Grade {g}</option>)}
                        </select>
                      </div>
                    </div>
                    {lossKg > 0 && (
                      <div className="space-y-2 pt-1 border-t border-warning-200">
                        <p className="text-xs font-semibold text-warning-700 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {lossKg.toLocaleString()} kg of <strong>{d.crop_name}</strong> unaccounted ({lossPct}%) — what happened to this specific batch?
                        </p>
                        {/* Shortfall type — per batch, independent */}
                        <div className="space-y-1.5">
                          {[
                            { v: 'TRANSIT_LOSS', label: 'Lost during transport (this batch)' },
                            { v: 'NOT_DISPATCHED', label: 'Never dispatched by cooperative (this batch)' },
                          ].map(opt => (
                            <label key={opt.v} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs ${form.shortfall_type === opt.v ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white'}`}>
                              <input type="radio" name={`shortfall_type_${d.id}`} value={opt.v} required
                                checked={form.shortfall_type === opt.v}
                                onChange={e => setBulkForms(prev => ({ ...prev, [d.id]: { ...prev[d.id], shortfall_type: e.target.value } }))}
                                className="accent-primary-600 flex-shrink-0" />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                        {form.shortfall_type === 'TRANSIT_LOSS' && (
                          <select className="input text-sm" required value={form.transit_loss_reason || ''}
                            onChange={e => setBulkForms(prev => ({ ...prev, [d.id]: { ...prev[d.id], transit_loss_reason: e.target.value } }))}>
                            <option value="">Cause of transit loss…</option>
                            <option value="SPOILAGE">Spoilage / Rot</option>
                            <option value="SPILLAGE">Spillage</option>
                            <option value="PHYSICAL_DAMAGE">Physical damage</option>
                            <option value="THEFT">Theft</option>
                            <option value="MOISTURE_LOSS">Moisture loss</option>
                            <option value="WEIGHT_DISCREPANCY">Weight discrepancy</option>
                            <option value="OTHER">Other</option>
                          </select>
                        )}
                        {form.shortfall_type === 'NOT_DISPATCHED' && (
                          <select className="input text-sm" required value={form.not_dispatched_reason || ''}
                            onChange={e => setBulkForms(prev => ({ ...prev, [d.id]: { ...prev[d.id], not_dispatched_reason: e.target.value } }))}>
                            <option value="">Why wasn't this batch dispatched?</option>
                            <option value="STOCK_UNAVAILABLE">Stock unavailable at cooperative</option>
                            <option value="QUALITY_REJECTED_AT_LOADING">Quality rejected at loading</option>
                            <option value="NOT_LOADED_BY_COOPERATIVE">Not loaded by cooperative before departure</option>
                            <option value="PARTIAL_AGREEMENT">Reduced quantity agreed at loading</option>
                            <option value="OTHER">Other</option>
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div>
              <label className="label">Notes (applies to this whole delivery)</label>
              <textarea className="input" rows={2} value={bulkNotes} onChange={e => setBulkNotes(e.target.value)}
                placeholder="Any additional observations about this delivery…" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setBulkGroup(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={bulkSaving}
                className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {bulkSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {bulkSaving ? 'Confirming…' : `Confirm All ${bulkGroup.length} Batches`}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Report Mismatch Modal — content/identity mismatch, not a quantity shortfall */}
      <Modal isOpen={!!mismatchTarget} onClose={() => setMismatchTarget(null)}
        title={`Report Mismatch — ${mismatchTarget?.batch_id_short || mismatchTarget?.batch_id || ''}`}>
        {mismatchTarget && (
          <form onSubmit={submitMismatch} className="space-y-4">
            <div className="bg-warning-50 border border-warning-200 rounded-xl p-3 text-sm text-warning-800">
              Use this when what physically arrived doesn't match this batch's record at all —
              not for a quantity shortfall (use Confirm Receipt for that instead).
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Cooperative</span><span className="font-medium text-gray-900">{mismatchTarget.cooperative_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Expected crop</span><span className="font-medium text-gray-900">{mismatchTarget.crop_name}</span></div>
            </div>
            <div>
              <label className="label">What did you actually receive? *</label>
              <input className="input" required placeholder="e.g. Potatoes instead of Tomatoes"
                value={mismatchForm.description}
                onChange={e => setMismatchForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input" rows={3} value={mismatchForm.notes}
                onChange={e => setMismatchForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any other details that will help the cooperative investigate…" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setMismatchTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={mismatchSaving}
                className="btn-danger flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {mismatchSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {mismatchSaving ? 'Reporting…' : 'Report Mismatch'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Live Vehicle Data modal */}
      <Modal isOpen={!!iotTarget} onClose={() => setIotTarget(null)}
        title={`Live Vehicle Data — ${iotTarget?.batch_id_short || ''}`}>
        {loadingIot ? (
          <div className="py-8 text-center text-gray-400 text-sm">Loading readings…</div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5" /> Temperature Readings
              </p>
              {!iotData?.temperature_readings?.length ? (
                <p className="text-sm text-gray-400">No temperature readings yet — the vehicle's IoT sensor hasn't reported.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {iotData.temperature_readings.map(r => (
                    <div key={r.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${r.is_breach ? 'bg-danger-50' : 'bg-gray-50'}`}>
                      <span className={`font-medium ${r.is_breach ? 'text-danger-600' : 'text-gray-800'}`}>{r.temperature_celsius}°C</span>
                      <span className="text-xs text-gray-400">{new Date(r.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Live Location
              </p>
              <TripTrackingMap route={iotData?.route} gpsTracks={iotData?.gps_tracks} height={340} />
            </div>

            <button onClick={() => setIotTarget(null)} className="btn-secondary w-full">Close</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
