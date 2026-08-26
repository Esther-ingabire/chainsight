import { useState, useEffect, useCallback } from 'react'
import { Truck, MapPin, Thermometer, Clock, CheckCircle, PackageCheck, AlertTriangle } from 'lucide-react'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { distributionApi } from '../../api/distribution.js'
import toast from 'react-hot-toast'

const MOCK_DELIVERIES = [
  {
    id: 'DEL-501', batch_id: 101, order_id: 'ORD-201', crop: 'Tomatoes', weight_kg: 500,
    transporter: 'Jean Mugisha', vehicle: 'RAD 342C', phone: '+250 788 123 456',
    origin: 'Musanze', destination: 'Kigali Central Market',
    dispatched: '2026-06-10 08:00', eta: '10:30',
    cold_chain: true, temp: 11.2, temp_status: 'ok',
    gps: 'Kigali – Nyabugogo area', status: 'IN_TRANSIT', progress: 75,
  },
  {
    id: 'DEL-502', batch_id: 102, order_id: 'ORD-203', crop: 'Beans', weight_kg: 200,
    transporter: 'Marie Uwase', vehicle: 'RAC 108A', phone: '+250 722 654 321',
    origin: 'Rwamagana', destination: 'Kigali Kimironko Market',
    dispatched: '2026-06-09 07:00', eta: null,
    cold_chain: false, temp: null, temp_status: null,
    gps: 'Kigali Kimironko', status: 'DELIVERED', progress: 100,
  },
  {
    id: 'DEL-503', batch_id: 103, order_id: 'ORD-204', crop: 'Avocados', weight_kg: 350,
    transporter: 'Patrick Nzeyimana', vehicle: 'RAB 789D', phone: '+250 722 111 222',
    origin: 'Huye', destination: 'Kigali Nyabugogo Market',
    dispatched: '2026-06-11 06:00', eta: '11:00',
    cold_chain: true, temp: 9.8, temp_status: 'ok',
    gps: 'Butare – Kigali highway', status: 'IN_TRANSIT', progress: 45,
  },
]

const RECEIPT_BLANK = { received_kg: '', quality_confirmed: 'A', loss_notes: '', additional_notes: '' }

function ProgressBar({ pct, color = 'bg-primary-500' }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function DeliveryTracking() {
  const [deliveries, setDeliveries] = useState(MOCK_DELIVERIES)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [receiptForm, setReceiptForm] = useState(RECEIPT_BLANK)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    distributionApi.getMyProduceRequests({ status: 'IN_TRANSIT' })
      .then(res => {
        const list = res.data?.results ?? res.data ?? []
        if (list.length) {
          const mapped = list.map(r => ({
            id: `DEL-${r.id}`,
            batch_id: r.batch_id ?? r.id,
            order_id: `ORD-${r.id}`,
            crop: r.crop_name || r.additional_notes || 'Unknown',
            weight_kg: Number(r.quantity_kg || 0),
            transporter: r.transporter_name || '—',
            vehicle: r.vehicle_plate || '—',
            phone: r.transporter_phone || '—',
            origin: r.cooperative_name || '—',
            destination: r.destination || 'Your warehouse',
            dispatched: r.dispatched_at || r.updated_at,
            eta: r.eta || null,
            cold_chain: r.requires_refrigeration ?? false,
            temp: null, temp_status: null, gps: '—',
            status: r.status,
            progress: r.status === 'DELIVERED' ? 100 : 60,
          }))
          setDeliveries(mapped)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'all'
    ? deliveries
    : deliveries.filter(d => d.status.toLowerCase().replace('_', '') === filter.replace('_', ''))

  const inTransit = deliveries.filter(d => d.status === 'IN_TRANSIT' || d.status === 'in_transit').length
  const delivered = deliveries.filter(d => d.status === 'DELIVERED' || d.status === 'delivered').length
  const awaitingConfirm = deliveries.filter(d => d.status === 'DELIVERED' || d.status === 'delivered').length

  const openConfirm = (del) => {
    setConfirmTarget(del)
    setReceiptForm({ ...RECEIPT_BLANK, received_kg: String(del.weight_kg) })
  }

  const submitted_kg = Number(receiptForm.received_kg || 0)
  const expected_kg = confirmTarget?.weight_kg || 0
  const loss_kg = Math.max(0, expected_kg - submitted_kg)
  const loss_pct = expected_kg > 0 ? ((loss_kg / expected_kg) * 100).toFixed(1) : 0

  const submitReceipt = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await distributionApi.confirmReceipt(confirmTarget.batch_id, {
        received_kg: submitted_kg,
        quality_confirmed: receiptForm.quality_confirmed,
        transit_loss_kg: loss_kg,
        loss_notes: receiptForm.loss_notes,
        additional_notes: receiptForm.additional_notes,
      })
      setDeliveries(prev => prev.map(d => d.id === confirmTarget.id ? { ...d, status: 'CONFIRMED', progress: 100 } : d))
      toast.success('Receipt confirmed — traceability record updated')
      setConfirmTarget(null)
      setReceiptForm(RECEIPT_BLANK)
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : 'Could not confirm receipt'
      toast.error(msg)
    } finally { setSubmitting(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Incoming Deliveries</h1>
        <p className="text-sm text-gray-500 mt-0.5">Track batches in transit and confirm receipt on arrival.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card flex items-center gap-4">
          <Truck className="w-6 h-6 text-primary-500" />
          <div><p className="text-xl font-bold">{inTransit}</p><p className="text-sm text-gray-500">In transit</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <CheckCircle className="w-6 h-6 text-success-500" />
          <div><p className="text-xl font-bold">{delivered}</p><p className="text-sm text-gray-500">Arrived today</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <PackageCheck className="w-6 h-6 text-warning-500" />
          <div><p className="text-xl font-bold">{awaitingConfirm}</p><p className="text-sm text-gray-500">Awaiting confirmation</p></div>
        </div>
      </div>

      <div className="flex gap-2">
        {['all', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
            {f === 'all' ? 'All' : f === 'IN_TRANSIT' ? 'In Transit' : f === 'DELIVERED' ? 'Arrived' : 'Confirmed'}
          </button>
        ))}
      </div>

      {loading && <div className="card py-12 text-center text-gray-400">Loading deliveries…</div>}

      <div className="space-y-4">
        {filtered.map(del => (
          <div key={del.id} className="card space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs text-gray-500">{del.id}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-gray-500">Order {del.order_id}</span>
                  {(del.status === 'DELIVERED' || del.status === 'delivered') && (
                    <span className="text-xs text-warning-600 font-medium bg-warning-50 px-2 py-0.5 rounded-full">Receipt pending</span>
                  )}
                </div>
                <h3 className="font-semibold text-gray-900">{del.crop} — {del.weight_kg.toLocaleString()} kg</h3>
                <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                  <MapPin className="w-3 h-3" />
                  <span>{del.origin} → {del.destination}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={del.status} />
                {(del.status === 'DELIVERED' || del.status === 'delivered') && (
                  <button onClick={() => openConfirm(del)} className="btn-primary text-sm flex items-center gap-1">
                    <PackageCheck className="w-4 h-4" /> Confirm Receipt
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                <span>{del.origin}</span>
                <span className="inline-flex items-center gap-1">
                  {del.status === 'DELIVERED' || del.status === 'delivered'
                    ? <><CheckCircle className="w-3 h-3 text-success-500" />Arrived</>
                    : del.eta ? `ETA ${del.eta}` : 'In transit'}
                </span>
                <span>{del.destination}</span>
              </div>
              <ProgressBar
                pct={del.progress}
                color={
                  del.status === 'CONFIRMED' ? 'bg-primary-600' :
                  del.status === 'DELIVERED' || del.status === 'delivered' ? 'bg-success-500' : 'bg-primary-500'
                }
              />
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">Transporter</p>
                <p className="font-medium text-gray-900 mt-0.5">{del.transporter}</p>
                <p className="text-xs text-gray-400">{del.vehicle}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">GPS / Last known</p>
                <p className="font-medium text-gray-900 mt-0.5">{del.gps}</p>
              </div>
              {del.cold_chain ? (
                <div className={`rounded-lg p-3 ${del.temp_status === 'ok' ? 'bg-success-50' : del.temp ? 'bg-danger-50' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${del.temp_status === 'ok' ? 'text-success-500' : 'text-gray-500'}`}>Cold chain</p>
                  {del.temp ? (
                    <p className={`font-medium mt-0.5 flex items-center gap-1 ${del.temp_status === 'ok' ? 'text-success-500' : 'text-danger-500'}`}>
                      <Thermometer className="w-3 h-3" /> {del.temp}°C
                    </p>
                  ) : (
                    <p className="font-medium text-gray-700 mt-0.5">Required</p>
                  )}
                  <p className="text-xs mt-0.5">{del.temp_status === 'ok' ? 'Within range' : del.temp ? 'Alert!' : 'Monitoring'}</p>
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Cold chain</p>
                  <p className="font-medium text-gray-900 mt-0.5">Not required</p>
                </div>
              )}
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div className="card py-16 text-center text-gray-400">
            <Truck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No deliveries in this category.</p>
          </div>
        )}
      </div>

      {/* Confirm Receipt modal */}
      <Modal isOpen={!!confirmTarget} onClose={() => { setConfirmTarget(null); setReceiptForm(RECEIPT_BLANK) }}
        title={`Confirm Receipt — ${confirmTarget?.crop || ''}`}>
        <form onSubmit={submitReceipt} className="space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Batch</span><span className="font-medium">{confirmTarget?.id}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Expected quantity</span><span className="font-medium">{confirmTarget?.weight_kg?.toLocaleString()} kg</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Origin</span><span className="font-medium">{confirmTarget?.origin}</span></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Received quantity (kg) *</label>
              <input type="number" className="input" value={receiptForm.received_kg}
                onChange={e => setReceiptForm(f => ({ ...f, received_kg: e.target.value }))}
                required min="0" max={confirmTarget?.weight_kg} step="0.1" />
            </div>
            <div>
              <label className="label">Quality confirmed</label>
              <select className="input" value={receiptForm.quality_confirmed} onChange={e => setReceiptForm(f => ({ ...f, quality_confirmed: e.target.value }))}>
                <option value="A">Grade A — As expected</option>
                <option value="B">Grade B — Minor issues</option>
                <option value="C">Grade C — Below standard</option>
              </select>
            </div>
          </div>

          {loss_kg > 0 && (
            <div className="bg-warning-50 border border-warning-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-warning-700">Transit loss detected: {loss_kg.toLocaleString()} kg ({loss_pct}%)</p>
                <p className="text-xs text-warning-600 mt-0.5">This will be recorded in the traceability chain.</p>
              </div>
            </div>
          )}

          <div>
            <label className="label">Loss reason (if any)</label>
            <input className="input" value={receiptForm.loss_notes}
              onChange={e => setReceiptForm(f => ({ ...f, loss_notes: e.target.value }))}
              placeholder="e.g. spoilage during transit, quantity mismatch" />
          </div>
          <div>
            <label className="label">Additional notes</label>
            <textarea className="input" rows={2} value={receiptForm.additional_notes}
              onChange={e => setReceiptForm(f => ({ ...f, additional_notes: e.target.value }))}
              placeholder="Any observations about condition, packaging…" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setConfirmTarget(null); setReceiptForm(RECEIPT_BLANK) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {submitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {submitting ? 'Confirming…' : 'Confirm Receipt'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
