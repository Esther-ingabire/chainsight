import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, RefreshCw, Package, Truck, Clock, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { marketAgentApi } from '../../api/marketAgent.js'
import toast from 'react-hot-toast'

function normStatus(s) {
  if (!s) return 'PENDING'
  if (s === 'PENDING_CONFIRMATION') return 'PENDING'
  if (['CONFIRMED', 'ADJUSTED'].includes(s)) return 'CONFIRMED'
  if (s === 'DECLINED') return 'DECLINED'
  return 'COMPLETED'
}

const STATUS_BADGE = {
  PENDING:   'bg-amber-50 text-amber-700 border border-amber-200',
  CONFIRMED: 'bg-primary-50 text-primary-700 border border-primary-200',
  DECLINED:  'bg-red-50 text-red-600 border border-red-200',
  COMPLETED: 'bg-gray-100 text-gray-500 border border-gray-200',
}
const STATUS_LABEL = {
  PENDING:   'Awaiting confirmation',
  CONFIRMED: 'Confirmed — ready to collect',
  DECLINED:  'Declined',
  COMPLETED: 'Collected',
}

const DELIVERY_LABEL = {
  SELF_COLLECTION:      { icon: Package, text: 'You self-collect from distributor' },
  TRANSPORTER_DELIVERY: { icon: Truck,   text: 'Distributor sends transport to you' },
}

const PILL_ACTIVE   = { ALL: 'bg-gray-800 text-white', PENDING: 'bg-amber-500 text-white', CONFIRMED: 'bg-primary-500 text-white', DECLINED: 'bg-red-700 text-white', COMPLETED: 'bg-gray-500 text-white' }
const PILL_INACTIVE = 'bg-gray-100 text-gray-600 hover:bg-gray-200'

export default function OrdersPage() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await marketAgentApi.getMyOrders()
      setOrders(res.data?.results ?? res.data ?? [])
    } catch {
      toast.error('Could not load orders')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const pending = orders.filter(o => normStatus(o.status) === 'PENDING').length
  const filtered = filter === 'ALL' ? orders : orders.filter(o => normStatus(o.status) === filter)

  const FILTERS = [
    { id: 'ALL',       label: `All (${orders.length})` },
    { id: 'PENDING',   label: `Pending (${orders.filter(o => normStatus(o.status) === 'PENDING').length})` },
    { id: 'CONFIRMED', label: `Confirmed (${orders.filter(o => normStatus(o.status) === 'CONFIRMED').length})` },
    { id: 'DECLINED',  label: `Declined (${orders.filter(o => normStatus(o.status) === 'DECLINED').length})` },
    { id: 'COMPLETED', label: `Collected (${orders.filter(o => normStatus(o.status) === 'COMPLETED').length})` },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Orders you've placed against distributor stock listings.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/market-agent/stock')} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Place Order
          </button>
          <button onClick={load} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 border border-gray-200">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Pending info banner */}
      {pending > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-800">
            {pending} order{pending > 1 ? 's' : ''} waiting for distributor confirmation
          </p>
        </div>
      )}

      {/* Filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${filter === f.id ? PILL_ACTIVE[f.id] : PILL_INACTIVE}`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-50" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="card py-14 text-center text-gray-400">
          <ShoppingBag className="w-9 h-9 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No {filter !== 'ALL' ? filter.toLowerCase() : ''} orders</p>
          {filter === 'ALL' && (
            <p className="text-xs mt-1">Go to <span className="text-primary-600 font-medium">Available Stock</span> to place your first order.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(order => {
            const norm = normStatus(order.status)
            const qty = Number(order.quantity_requested_kg)
            const confirmedQty = order.confirmed_quantity_kg ? Number(order.confirmed_quantity_kg) : null
            const qtyLabel = qty >= 1000 ? `${(qty / 1000).toFixed(1)} tons` : `${qty} kg`
            const confirmedLabel = confirmedQty
              ? (confirmedQty >= 1000 ? `${(confirmedQty / 1000).toFixed(1)} tons` : `${confirmedQty} kg`)
              : null
            const date = order.preferred_collection_date
              ? new Date(order.preferred_collection_date).toLocaleDateString('en-RW', { day: 'numeric', month: 'short' })
              : null
            const delivery = order.delivery_method ? DELIVERY_LABEL[order.delivery_method] : null

            return (
              <div key={order.id} className="card py-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="font-semibold text-sm text-gray-900">{order.crop_name}</p>
                    <p className="text-xs text-gray-500">
                      from <span className="font-medium text-gray-700">{order.distributor_name}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Requested: {qtyLabel}
                      {confirmedLabel && confirmedLabel !== qtyLabel && (
                        <span className="text-primary-600 font-medium"> → confirmed: {confirmedLabel}</span>
                      )}
                      {date && <>{' · '} collect by {date}</>}
                    </p>
                    {delivery && (
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <delivery.icon className="w-3 h-3" />{delivery.text}
                      </p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[norm]}`}>
                    {STATUS_LABEL[norm]}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
