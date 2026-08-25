import { useEffect, useState, useCallback } from 'react'
import { Bell, AlertTriangle, AlertCircle, CheckCircle, MapPin, Calendar, Plus, Package, Truck, ArrowUpDown } from 'lucide-react'
import Modal from '../../components/ui/Modal.jsx'
import { marketAgentApi } from '../../api/marketAgent.js'
import toast from 'react-hot-toast'

const RISK_CONFIG = {
  LOW:   { color: 'bg-success-50 border-success-300 text-success-700', icon: CheckCircle, label: 'Low Risk — Safe to self-collect' },
  AMBER: { color: 'bg-warning-50 border-warning-300 text-warning-700', icon: AlertTriangle, label: 'Amber Risk — Consider using a transporter' },
  HIGH:  { color: 'bg-danger-50 border-danger-300 text-danger-700', icon: AlertCircle, label: 'High Risk — Use a transporter' },
}

const BLANK_ORDER = { quantity_requested_kg: '', preferred_collection_date: '', delivery_method: 'SELF_COLLECTION', notes: '' }

function RiskBanner({ risk, label }) {
  const cfg = RISK_CONFIG[risk] || RISK_CONFIG.LOW
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium mb-3 ${cfg.color}`}>
      <cfg.icon className="w-4 h-4 flex-shrink-0" />
      {label || cfg.label}
    </div>
  )
}

export default function NoticesPage() {
  const [notices, setNotices] = useState([])
  const [loading, setLoading] = useState(true)
  const [orderTarget, setOrderTarget] = useState(null)   // the notice being ordered from
  const [orderForm, setOrderForm] = useState(BLANK_ORDER)
  const [placing, setPlacing] = useState(false)
  const [sort, setSort] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [cropFilter, setCropFilter] = useState('')
  const [distFilter, setDistFilter] = useState('')

  const loadNotices = useCallback(() => {
    setLoading(true)
    const params = {}
    if (sort) params.sort = sort
    // maxPrice applied client-side below to avoid refetch on every keystroke
    marketAgentApi.getNotices(params)
      .then(res => setNotices(res.data?.results ?? res.data ?? []))
      .catch(() => toast.error('Could not load notices.'))
      .finally(() => setLoading(false))
  }, [sort])

  useEffect(() => { loadNotices() }, [loadNotices])

  const openOrder = (notice) => {
    setOrderTarget(notice)
    setOrderForm({
      ...BLANK_ORDER,
      quantity_requested_kg: '',
    })
  }

  const submitOrder = async (e) => {
    e.preventDefault()
    const qty = Number(orderForm.quantity_requested_kg)
    if (!qty || qty <= 0) { toast.error('Enter a valid quantity'); return }
    if (qty > Number(orderTarget.available_quantity_kg)) {
      toast.error(`Max available is ${orderTarget.available_quantity_kg} kg`)
      return
    }
    setPlacing(true)
    try {
      await marketAgentApi.placeOrder({
        collection_notice: orderTarget.id,
        quantity_requested_kg: qty,
        preferred_collection_date: orderForm.preferred_collection_date || null,
        delivery_method: orderForm.delivery_method,
        notes: orderForm.notes,
      })
      toast.success(`Order placed for ${qty} kg of ${orderTarget.crop_name} — waiting for distributor to confirm.`)
      setOrderTarget(null)
      setOrderForm(BLANK_ORDER)
    } catch (err) {
      const data = err?.response?.data
      const flatMsg = (d) => {
        if (!d) return ''
        if (typeof d === 'string') return d
        if (Array.isArray(d)) return d.map(flatMsg).join(' ')
        if (typeof d === 'object') return Object.values(d).map(flatMsg).join(' ')
        return String(d)
      }
      toast.error(flatMsg(data) || 'Could not place order')
    } finally { setPlacing(false) }
  }

  if (loading) return (
    <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="card animate-pulse h-32 bg-gray-100" />)}
    </div>
  )

  // Unique crops and distributors for filter dropdowns
  const allCrops = [...new Set(notices.map(n => n.crop_name).filter(Boolean))].sort()
  const allDists = [...new Set(notices.map(n => n.distributor_name).filter(Boolean))].sort()

  // Apply all client-side filters — no refetch on keystroke
  let filtered = notices
  if (cropFilter) filtered = filtered.filter(n => n.crop_name === cropFilter)
  if (distFilter) filtered = filtered.filter(n => n.distributor_name === distFilter)
  if (maxPrice && !isNaN(Number(maxPrice))) filtered = filtered.filter(n => !n.price_per_kg || Number(n.price_per_kg) <= Number(maxPrice))

  let ordered = filtered
  if (!sort) {
    const grouped = { HIGH: [], AMBER: [], LOW: [] }
    filtered.forEach(n => (grouped[n.risk_level] ??= []).push(n))
    ordered = [...(grouped.HIGH || []), ...(grouped.AMBER || []), ...(grouped.LOW || [])]
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Available Stock</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Stock listings from your linked distributors. Place an order to reserve produce.
            {(cropFilter || distFilter) && (
              <span className="ml-2 font-medium text-primary-600">
                {ordered.length} of {notices.length} shown
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Crop filter */}
          <select className="input text-sm" value={cropFilter} onChange={e => setCropFilter(e.target.value)}>
            <option value="">All crops</option>
            {allCrops.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Distributor filter */}
          <select className="input text-sm" value={distFilter} onChange={e => setDistFilter(e.target.value)}>
            <option value="">All distributors</option>
            {allDists.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          {/* Max price */}
          <input
            type="number"
            className="input w-32 text-sm"
            placeholder="Max RWF/kg"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value)}
          />

          {/* Sort */}
          <div className="relative">
            <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <select className="input pl-7 text-sm" value={sort} onChange={e => setSort(e.target.value)}>
              <option value="">Sort by risk</option>
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
            </select>
          </div>

          {/* Clear filters */}
          {(cropFilter || distFilter || maxPrice) && (
            <button
              onClick={() => { setCropFilter(''); setDistFilter(''); setMaxPrice('') }}
              className="text-xs text-gray-500 hover:text-danger-600 underline whitespace-nowrap">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No available stock right now.</p>
          <p className="text-xs mt-1">Your linked distributors haven't posted any active listings.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {ordered.map(notice => {
            const deadlineStr = notice.collection_deadline
              ? new Date(notice.collection_deadline).toLocaleDateString('en-RW', { day: 'numeric', month: 'short', year: 'numeric' })
              : null
            const qtyTons = (Number(notice.available_quantity_kg) / 1000).toFixed(1)
            return (
              <div key={notice.id} className="card">
                {notice.risk_level && <RiskBanner risk={notice.risk_level} label={notice.risk_label} />}

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">
                      Ready for Collection
                    </span>
                    <h3 className="font-semibold text-gray-900 text-base mt-2">{notice.distributor_name}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      <span className="font-medium text-gray-700">{notice.crop_name}</span>
                      {' · '}{qtyTons} tons available
                      {notice.price_per_kg ? ` · RWF ${Number(notice.price_per_kg).toLocaleString()}/kg` : ''}
                    </p>
                    {notice.pickup_location && (
                      <p className="text-sm text-gray-400 mt-1 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {notice.pickup_location}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 flex items-center gap-1 whitespace-nowrap">
                    <Calendar className="w-3.5 h-3.5" /> {deadlineStr ? `Until ${deadlineStr}` : 'Open — no deadline'}
                  </p>
                </div>

                <button
                  onClick={() => openOrder(notice)}
                  className="btn-primary w-full mt-4 py-2.5 text-sm flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Place Order
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Place Order modal */}
      <Modal isOpen={!!orderTarget} onClose={() => setOrderTarget(null)} title="Place Order">
        {orderTarget && (
          <form onSubmit={submitOrder} className="space-y-4">
            {/* Notice summary */}
            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
              <p className="font-semibold text-gray-900">{orderTarget.distributor_name}</p>
              <p className="text-gray-500">
                {orderTarget.crop_name} · {(Number(orderTarget.available_quantity_kg) / 1000).toFixed(1)} tons available
              </p>
              {orderTarget.pickup_location && (
                <p className="text-gray-400 flex items-center gap-1 text-xs">
                  <MapPin className="w-3 h-3" /> {orderTarget.pickup_location}
                </p>
              )}
            </div>

            <div>
              <label className="label">Quantity needed (kg) *</label>
              <input
                type="number"
                className="input"
                value={orderForm.quantity_requested_kg}
                onChange={e => setOrderForm(f => ({ ...f, quantity_requested_kg: e.target.value }))}
                required min="1"
                max={orderTarget.available_quantity_kg}
                placeholder={`Max ${orderTarget.available_quantity_kg} kg`}
              />
            </div>

            <div>
              <label className="label">Preferred collection date</label>
              <input
                type="date"
                className="input"
                value={orderForm.preferred_collection_date}
                onChange={e => setOrderForm(f => ({ ...f, preferred_collection_date: e.target.value }))}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>

            <div>
              <label className="label">How do you want this delivered?</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setOrderForm(f => ({ ...f, delivery_method: 'SELF_COLLECTION' }))}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-colors
                    ${orderForm.delivery_method === 'SELF_COLLECTION'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  <Package className="w-5 h-5" />
                  I'll self-collect
                  <span className="text-xs font-normal text-gray-400">I'll come pick it up</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOrderForm(f => ({ ...f, delivery_method: 'TRANSPORTER_DELIVERY' }))}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-colors
                    ${orderForm.delivery_method === 'TRANSPORTER_DELIVERY'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  <Truck className="w-5 h-5" />
                  Send it to me
                  <span className="text-xs font-normal text-gray-400">Distributor arranges transport</span>
                </button>
              </div>
            </div>

            <div>
              <label className="label">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea
                className="input resize-none"
                rows={2}
                value={orderForm.notes}
                onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Grade A only, early morning preferred..."
              />
            </div>

            <p className="text-xs text-gray-400">
              After placing, the distributor will confirm your order and set the delivery method (self-collect or they send transport).
            </p>

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setOrderTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={placing} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {placing && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {placing ? 'Placing...' : 'Place Order'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
