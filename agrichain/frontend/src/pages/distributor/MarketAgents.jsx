import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Search, Phone, MapPin, Trash2, TrendingDown, RefreshCw,
         CheckCircle, X, Clock, ShoppingBag, AlertTriangle, FileText, Truck, Package } from 'lucide-react'
import Modal from '../../components/ui/Modal.jsx'
import DeclineReasonPicker from '../../components/ui/DeclineReasonPicker.jsx'
import PlaceSearchInput from '../../components/map/PlaceSearchInput.jsx'
import { distributionApi } from '../../api/distribution.js'
import toast from 'react-hot-toast'
import { useLocation } from 'react-router-dom'

const AGENT_REJECT_REASONS = ['Already at capacity', 'Service area mismatch', 'No available stock for this area', 'Duplicate application']
const ORDER_DECLINE_REASONS = ['Out of stock', 'Quantity unavailable', 'Cannot meet delivery date', 'Order already fulfilled']

const NOTICE_BLANK = {
  crop_name: '', quantity_available_kg: '', price_per_kg: '',
  available_until: '', pickup_location: '', notes: '',
}

// Normalize real API statuses → display buckets
function normStatus(s) {
  if (!s) return 'PENDING'
  if (s === 'PENDING_CONFIRMATION') return 'PENDING'
  if (['CONFIRMED', 'ADJUSTED'].includes(s)) return 'ACCEPTED'
  if (s === 'DECLINED') return 'DECLINED'
  return 'COMPLETED'
}

const STATUS_BADGE = {
  PENDING:   'bg-amber-50   text-amber-700   border border-amber-200',
  ACCEPTED:  'bg-emerald-50 text-emerald-700  border border-emerald-200',
  DECLINED:  'bg-red-50     text-red-600     border border-red-200',
  COMPLETED: 'bg-gray-100   text-gray-500    border border-gray-200',
}
const STATUS_LABEL = { PENDING: 'Pending', ACCEPTED: 'Accepted', DECLINED: 'Declined', COMPLETED: 'Completed' }

const PILL_ACTIVE = {
  ALL:       'bg-gray-800 text-white',
  PENDING:   'bg-amber-500 text-white',
  ACCEPTED:  'bg-emerald-600 text-white',
  DECLINED:  'bg-red-500 text-white',
  COMPLETED: 'bg-gray-500 text-white',
}
const PILL_INACTIVE = 'bg-gray-100 text-gray-600 hover:bg-gray-200'

export default function MarketAgents() {
  const location = useLocation()
  const initialTab = location.search.includes('tab=orders') ? 'orders' : 'agents'
  const [tab, setTab] = useState(initialTab) // 'agents' | 'orders' | 'listings'

  // ── Linked agents state ──
  const [agents, setAgents]               = useState([])
  const [pendingRequests, setPendingRequests] = useState([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')
  const [showLink, setShowLink]           = useState(false)
  const [linkPhone, setLinkPhone]         = useState('')
  const [saving, setSaving]               = useState(false)
  const [removingId, setRemovingId]       = useState(null)
  const [approvingId, setApprovingId]     = useState(null)
  const [rejectingId, setRejectingId]     = useState(null)

  // ── Orders state ──
  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [orderFilter, setOrderFilter] = useState('ALL')
  const [acceptTarget, setAcceptTarget] = useState(null)
  const [accepting, setAccepting] = useState(false)
  const [decliningId, setDecliningId] = useState(null)
  const [showDeclineId, setShowDeclineId] = useState(null)

  // ── Stock listings state ──
  const [notices, setNotices] = useState([])
  const [loadingNotices, setLoadingNotices] = useState(true)
  const [showNoticeForm, setShowNoticeForm] = useState(false)
  const [noticeForm, setNoticeForm] = useState(NOTICE_BLANK)
  const [noticeSaving, setNoticeSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await distributionApi.getPendingAgentRequests()
      const all = res.data?.results ?? res.data ?? []
      setAgents(all.filter(l => l.is_active))
      setPendingRequests(all.filter(l => !l.is_active))
    } catch {
      try {
        const res = await distributionApi.getMyMarketAgents({})
        setAgents(res.data?.results ?? res.data ?? [])
      } catch {}
    } finally { setLoading(false) }
  }, [])

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await distributionApi.getMyOrders({})
      const list = res.data?.results ?? res.data ?? []
      setOrders(list)
    } catch { setOrders([]) }
    finally { setLoadingOrders(false) }
  }, [])

  const loadNotices = useCallback(async () => {
    setLoadingNotices(true)
    try {
      const res = await distributionApi.getMyNotices({})
      const list = res.data?.results ?? res.data ?? []
      setNotices(list)
    } catch { setNotices([]) }
    finally { setLoadingNotices(false) }
  }, [])

  useEffect(() => { load(); loadOrders(); loadNotices() }, [load, loadOrders, loadNotices])

  // ── Linked agent handlers ──
  const handleApprove = async (req) => {
    setApprovingId(req.id)
    try {
      await distributionApi.approveLinkRequest(req.id)
      setPendingRequests(prev => prev.filter(r => r.id !== req.id))
      setAgents(prev => [...prev, { ...req, is_active: true }])
      toast.success(`${req.name || req.agent_name} approved and linked`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not approve')
    } finally { setApprovingId(null) }
  }

  const handleReject = async (req, reason) => {
    setApprovingId(req.id)
    setRejectingId(null)
    try {
      await distributionApi.rejectLinkRequest(req.id, { reason: reason || 'Declined' })
      setPendingRequests(prev => prev.filter(r => r.id !== req.id))
      toast.success('Request rejected')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not reject')
    } finally { setApprovingId(null) }
  }

  const handleLink = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await distributionApi.addMarketAgentLink({ phone_number: linkPhone })
      setAgents(prev => [res.data, ...prev])
      toast.success('Market agent linked successfully')
      setShowLink(false)
      setLinkPhone('')
    } catch (err) {
      const msg = err.response?.data ? Object.values(err.response.data).flat().join(' ') : 'Agent not found — check phone number'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  const handleRemove = async (agent) => {
    const name = agent.agent_name || agent.name || 'this agent'
    if (!window.confirm(`Unlink ${name}? They will no longer see your collection notices.`)) return
    setRemovingId(agent.id)
    try { await distributionApi.removeMarketAgentLink(agent.id) } catch {}
    setAgents(prev => prev.filter(a => a.id !== agent.id))
    toast.success('Agent unlinked')
    setRemovingId(null)
  }

  const filtered = agents.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return (a.agent_name || a.name || '').toLowerCase().includes(q)
      || (a.market_name || a.market || '').toLowerCase().includes(q)
      || (a.district || '').toLowerCase().includes(q)
  })

  const totalOrders = agents.reduce((s, a) => s + (a.total_orders || 0), 0)
  const avgLoss = agents.length
    ? (agents.reduce((s, a) => s + (a.avg_self_transport_loss_pct || 0), 0) / agents.length).toFixed(1)
    : '—'
  const highRisk = agents.filter(a => (a.avg_self_transport_loss_pct || 0) > 5).length

  const lossColor = (pct) => {
    if (pct > 5) return 'text-danger-600'
    if (pct > 3) return 'text-warning-600'
    return 'text-success-600'
  }

  // ── Order handlers ──
  const openAccept = (order) => setAcceptTarget(order)

  const openNoticeForOrder = (order) => {
    setNoticeForm({
      ...NOTICE_BLANK,
      crop_name: order.crop_name || '',
      quantity_available_kg: order.quantity_requested_kg || '',
      title: order.crop_name
        ? `${order.crop_name} Available – ${new Date().toLocaleDateString('en-RW', { month: 'long', year: 'numeric' })}`
        : '',
    })
    setTab('listings')
    setShowNoticeForm(true)
  }

  const confirmAccept = async () => {
    if (!acceptTarget) return
    setAccepting(true)
    const method = acceptTarget.delivery_method || 'SELF_COLLECTION'
    try {
      await distributionApi.confirmOrder(acceptTarget.id, { delivery_method: method })
    } catch (err) {
      if (err?.response?.status !== 404) {
        toast.error(err?.response?.data?.detail || 'Could not accept order')
        setAccepting(false)
        return
      }
    }
    setOrders(prev => prev.map(o =>
      o.id === acceptTarget.id ? { ...o, status: 'CONFIRMED', delivery_method: method } : o
    ))
    toast.success(`Order accepted · ${method === 'SELF_COLLECTION' ? 'Agent will self-collect' : 'You arrange transport'}`)
    setAcceptTarget(null)
    setAccepting(false)
  }

  const handleDecline = async (order, reason) => {
    setDecliningId(order.id)
    setShowDeclineId(null)
    try {
      await distributionApi.declineOrder(order.id, { reason: reason || 'Declined' })
    } catch (err) {
      if (err?.response?.status !== 404) {
        toast.error(err?.response?.data?.detail || 'Could not decline order')
        setDecliningId(null)
        return
      }
    }
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'DECLINED' } : o))
    toast.success('Order declined')
    setDecliningId(null)
  }

  const pendingOrderCount = orders.filter(o => normStatus(o.status) === 'PENDING').length
  const activeNoticeCount = notices.filter(n => n.is_active).length
  const filteredOrders = orderFilter === 'ALL' ? orders : orders.filter(o => normStatus(o.status) === orderFilter)

  const ORDER_FILTERS = [
    { id: 'ALL',       label: `All (${orders.length})` },
    { id: 'PENDING',   label: `Pending (${orders.filter(o => normStatus(o.status) === 'PENDING').length})` },
    { id: 'ACCEPTED',  label: `Accepted (${orders.filter(o => normStatus(o.status) === 'ACCEPTED').length})` },
    { id: 'DECLINED',  label: `Declined (${orders.filter(o => normStatus(o.status) === 'DECLINED').length})` },
    { id: 'COMPLETED', label: `Completed (${orders.filter(o => normStatus(o.status) === 'COMPLETED').length})` },
  ]

  // ── Stock listing handlers ──
  const submitNotice = async (e) => {
    e.preventDefault()
    if (!noticeForm.pickup_location) { toast.error('Search and select a pickup location from the dropdown'); return }
    setNoticeSaving(true)
    try {
      const res = await distributionApi.createNotice({
        ...noticeForm,
        quantity_available_kg: Number(noticeForm.quantity_available_kg),
        price_per_kg: Number(noticeForm.price_per_kg) || 0,
        is_active: true,
      })
      setNotices(prev => [{ ...res.data, orders_count: 0 }, ...prev])
      toast.success('Stock listing published — linked agents can now order from it')
      setShowNoticeForm(false)
      setNoticeForm(NOTICE_BLANK)
    } catch (err) {
      const data = err?.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Failed to publish listing')
    } finally { setNoticeSaving(false) }
  }

  const TABS = [
    { id: 'agents',   label: `Linked Agents${pendingRequests.length ? ` · ${pendingRequests.length} pending` : ''}`, icon: Users },
    { id: 'orders',   label: `Orders${pendingOrderCount ? ` · ${pendingOrderCount} pending` : ''}`, icon: ShoppingBag },
    { id: 'listings', label: `Stock Listings${activeNoticeCount ? ` · ${activeNoticeCount} active` : ''}`, icon: FileText },
  ]

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Market Agents</h1>
          <p className="text-sm text-gray-500 mt-0.5">Everything related to your linked market agents — connections, orders, and stock listings.</p>
        </div>
        <div className="flex gap-2">
          {tab === 'agents' && (
            <button onClick={() => setShowLink(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Link Agent
            </button>
          )}
          {tab === 'listings' && (
            <button onClick={() => setShowNoticeForm(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Post Listing
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${tab === t.id ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* ── Linked Agents tab ── */}
      {tab === 'agents' && (
        <div className="space-y-6">
          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-primary-600" />
              </div>
              <div><p className="text-xl font-bold text-gray-900">{agents.length}</p><p className="text-xs text-gray-500">Linked agents</p></div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success-50 flex items-center justify-center flex-shrink-0">
                <ShoppingBag className="w-5 h-5 text-success-600" />
              </div>
              <div><p className="text-xl font-bold text-gray-900">{totalOrders}</p><p className="text-xs text-gray-500">Total orders placed</p></div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-warning-50 flex items-center justify-center flex-shrink-0">
                <TrendingDown className="w-5 h-5 text-warning-500" />
              </div>
              <div><p className="text-xl font-bold text-gray-900">{avgLoss}%</p><p className="text-xs text-gray-500">Avg self-transport loss</p></div>
            </div>
            <div className="card flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${highRisk > 0 ? 'bg-danger-50' : 'bg-gray-100'}`}>
                <AlertTriangle className={`w-5 h-5 ${highRisk > 0 ? 'text-danger-500' : 'text-gray-400'}`} />
              </div>
              <div>
                <p className={`text-xl font-bold ${highRisk > 0 ? 'text-danger-600' : 'text-gray-900'}`}>{highRisk}</p>
                <p className="text-xs text-gray-500">High-loss agents (&gt;5%)</p>
              </div>
            </div>
          </div>

          {/* Pending connection requests */}
          {pendingRequests.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-warning-500" /> Pending Connection Requests — {pendingRequests.length}
              </p>
              {pendingRequests.map(req => (
                <div key={req.id}>
                  <div className="card py-4 flex items-center gap-4 border-warning-200 bg-warning-50/40">
                    <div className="w-11 h-11 rounded-xl bg-warning-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-warning-700 font-bold text-base">{(req.agent_name || req.name || 'A')[0]}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-900">{req.agent_name || req.name || '—'}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        {(req.market_name || req.market) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {req.market_name || req.market}
                          </span>
                        )}
                        {req.district && <span>{req.district}</span>}
                        {req.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{req.phone}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => handleApprove(req)} disabled={approvingId === req.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-primary-500 hover:bg-primary-600 text-white transition-colors disabled:opacity-60">
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button onClick={() => setRejectingId(req.id)} disabled={approvingId === req.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-60">
                        <X className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                  {rejectingId === req.id && (
                    <div className="mt-1">
                      <DeclineReasonPicker quickReasons={AGENT_REJECT_REASONS} busy={approvingId === req.id}
                        label="Confirm Rejection" onConfirm={reason => handleReject(req, reason)} onCancel={() => setRejectingId(null)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                className="input pl-9" placeholder="Search by name, market, or district…" />
            </div>
            <button onClick={load} className="p-2.5 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 border border-gray-200">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Linked agent list */}
          {loading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-50" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="card py-16 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No linked market agents yet</p>
              <p className="text-sm mt-1">Link an agent so they can see your collection notices and place orders.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(agent => {
                const name     = agent.agent_name || agent.name || '—'
                const market   = agent.market_name || agent.market || '—'
                const district = agent.district || '—'
                const phone    = agent.phone || agent.contact_phone || ''
                const ordersCount = agent.total_orders || 0
                const loss     = agent.avg_self_transport_loss_pct
                const initials = name[0]?.toUpperCase() || 'A'
                const isHighRisk = loss > 5
                return (
                  <div key={agent.id} className={`card flex items-center gap-5 ${isHighRisk ? 'border-l-4 border-l-danger-400' : ''}`}>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-base ${isHighRisk ? 'bg-danger-50 text-danger-700' : 'bg-primary-50 text-primary-700'}`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{name}</p>
                        {isHighRisk && (
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-danger-50 text-danger-600 border border-danger-200">
                            <AlertTriangle className="w-3 h-3" /> High loss
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-gray-400" /> {market}
                        </span>
                        <span className="text-gray-400">{district}</span>
                        {phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-gray-400" />{phone}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-right flex-shrink-0">
                      <div>
                        <p className="text-lg font-bold text-gray-900">{ordersCount}</p>
                        <p className="text-xs text-gray-500">Orders</p>
                      </div>
                      <div>
                        <p className={`text-lg font-bold ${loss != null ? lossColor(loss) : 'text-gray-400'}`}>
                          {loss != null ? `${Number(loss).toFixed(1)}%` : '—'}
                        </p>
                        <p className="text-xs text-gray-500">Self-transport loss</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-700">{agent.stall_number ? `Stall ${agent.stall_number}` : '—'}</p>
                        <p className="text-xs text-gray-400">Stall no.</p>
                      </div>
                      <button onClick={() => handleRemove(agent)} disabled={removingId === agent.id}
                        className="p-2 text-gray-300 hover:text-danger-500 hover:bg-danger-50 rounded-lg transition-colors disabled:opacity-40"
                        title="Unlink agent">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Orders tab ── */}
      {tab === 'orders' && (
        <div className="space-y-4">
          {pendingOrderCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
              <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-sm font-medium text-amber-800">
                {pendingOrderCount} order{pendingOrderCount > 1 ? 's' : ''} waiting for your response
              </p>
              <button onClick={() => setOrderFilter('PENDING')}
                className="ml-auto text-xs font-semibold text-amber-700 underline underline-offset-2">
                Review
              </button>
            </div>
          )}

          <div className="flex gap-1.5 flex-wrap">
            {ORDER_FILTERS.map(f => (
              <button key={f.id} onClick={() => setOrderFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${orderFilter === f.id ? PILL_ACTIVE[f.id] : PILL_INACTIVE}`}>
                {f.label}
              </button>
            ))}
          </div>

          {loadingOrders ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-50" />)}</div>
          ) : filteredOrders.length === 0 ? (
            <div className="card py-14 text-center text-gray-400">
              <ShoppingBag className="w-9 h-9 mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No {orderFilter !== 'ALL' ? STATUS_LABEL[orderFilter].toLowerCase() : ''} orders</p>
              <p className="text-xs mt-1">Orders placed by your linked agents against your stock listings will appear here.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredOrders.map(order => {
                const norm = normStatus(order.status)
                const isPending = norm === 'PENDING'
                const busyDecline = decliningId === order.id
                const qty = Number(order.quantity_requested_kg)
                const qtyLabel = `${qty.toLocaleString()} kg`
                const price = Number(order.price_per_kg) || 0
                const deadlineRaw = order.preferred_collection_date
                const deadline = deadlineRaw
                  ? new Date(deadlineRaw).toLocaleDateString('en-RW', { month: 'short', day: 'numeric' })
                  : null

                return (
                  <div key={order.id} className="card py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-900 truncate">{order.market_agent_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <span className="font-medium text-gray-700">{order.crop_name}</span>
                          {' · '}{qtyLabel}
                          {price > 0 && <>{' · '}RWF {price.toLocaleString()}/kg</>}
                          {deadline && <>{' · '}collect by {deadline}</>}
                        </p>
                        {price > 0 && (
                          <p className="text-xs text-success-700 font-medium mt-0.5">
                            Est. value: RWF {(price * qty).toLocaleString()}
                          </p>
                        )}
                        {order.notes && <p className="text-xs text-gray-400 italic mt-0.5">"{order.notes}"</p>}
                        {order.delivery_method && norm !== 'PENDING' && (
                          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            {order.delivery_method === 'SELF_COLLECTION'
                              ? <><Package className="w-3 h-3" />Agent self-collects</>
                              : <><Truck className="w-3 h-3" />Distributor arranges transport</>}
                          </p>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[norm]}`}>
                        {STATUS_LABEL[norm]}
                      </span>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => openAccept(order)}
                        disabled={!isPending}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                          ${isPending ? 'bg-primary-500 hover:bg-primary-600 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}>
                        <CheckCircle className="w-3.5 h-3.5" /> Accept
                      </button>
                      {isPending && (
                        <button
                          onClick={() => setShowDeclineId(order.id)}
                          disabled={busyDecline}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-60">
                          <X className="w-3.5 h-3.5" /> Decline
                        </button>
                      )}
                      <button
                        onClick={() => openNoticeForOrder(order)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-600 border border-primary-200 hover:bg-primary-50 transition-colors ml-auto">
                        <Plus className="w-3.5 h-3.5" /> Post Listing
                      </button>
                    </div>
                    {showDeclineId === order.id && (
                      <div className="mt-2">
                        <DeclineReasonPicker
                          quickReasons={ORDER_DECLINE_REASONS}
                          busy={busyDecline}
                          onConfirm={reason => handleDecline(order, reason)}
                          onCancel={() => setShowDeclineId(null)}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Stock Listings tab ── */}
      {tab === 'listings' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 -mt-2">
            Your linked agents browse these listings and place orders against them.
            Orders then appear in{' '}
            <button onClick={() => setTab('orders')} className="text-primary-600 underline underline-offset-2">Orders</button>.
          </p>

          {loadingNotices ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-50" />)}</div>
          ) : notices.length === 0 ? (
            <div className="card py-14 text-center text-gray-400">
              <FileText className="w-9 h-9 mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No listings yet</p>
              <p className="text-xs mt-1">Post your first listing so agents know what you have available.</p>
              <button onClick={() => setShowNoticeForm(true)} className="btn-primary mt-3 inline-flex items-center gap-2 text-sm">
                <Plus className="w-4 h-4" /> Post Listing
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {notices.map(n => (
                <div key={n.id} className="card py-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-gray-900 truncate">{n.crop_name} — Ready for Collection</p>
                        <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full
                          ${n.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                          {n.is_active ? 'Active' : 'Closed'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">{n.crop_name}</span>
                        {' · '}
                        {Number(n.available_quantity_kg || n.quantity_available_kg).toLocaleString()} kg available
                        {n.price_per_kg ? ` · RWF ${Number(n.price_per_kg).toLocaleString()}/kg` : ''}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-gray-400 mt-1 flex-wrap">
                        {n.pickup_location && (
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{n.pickup_location}</span>
                        )}
                        {n.collection_deadline && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />Collect by {new Date(n.collection_deadline).toLocaleDateString('en-RW', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-center min-w-[44px]">
                      <p className={`text-xl font-bold ${n.orders_count > 0 ? 'text-primary-600' : 'text-gray-300'}`}>
                        {n.orders_count ?? 0}
                      </p>
                      <p className="text-[10px] text-gray-400">order{n.orders_count !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Link agent modal */}
      <Modal isOpen={showLink} onClose={() => { setShowLink(false); setLinkPhone('') }} title="Link Market Agent">
        <form onSubmit={handleLink} className="space-y-4">
          <p className="text-sm text-gray-500">
            Enter the phone number of the market agent registered in ChainSight.
            They will be notified when linked and can immediately start viewing your collection notices.
          </p>
          <div>
            <label className="label">Agent phone number *</label>
            <input className="input" value={linkPhone} onChange={e => setLinkPhone(e.target.value)}
              required placeholder="+250 7XX XXX XXX" type="tel" />
            <p className="text-xs text-gray-400 mt-1">Must match exactly the number they registered with on ChainSight.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowLink(false); setLinkPhone('') }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Linking…' : 'Link Agent'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Accept Order modal — shows the delivery method the agent already chose */}
      <Modal isOpen={!!acceptTarget} onClose={() => setAcceptTarget(null)} title="Accept Order">
        {acceptTarget && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
              <p className="font-semibold text-gray-900">{acceptTarget.market_agent_name}</p>
              <p className="text-gray-500">
                {acceptTarget.crop_name}{' · '}
                {Number(acceptTarget.quantity_requested_kg).toLocaleString()} kg
                {Number(acceptTarget.price_per_kg) > 0 && <>{' · '}RWF {Number(acceptTarget.price_per_kg).toLocaleString()}/kg</>}
              </p>
              {Number(acceptTarget.price_per_kg) > 0 && (
                <p className="text-success-700 font-semibold">
                  Est. value: RWF {(Number(acceptTarget.price_per_kg) * Number(acceptTarget.quantity_requested_kg)).toLocaleString()}
                </p>
              )}
            </div>
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium
              ${acceptTarget.delivery_method === 'TRANSPORTER_DELIVERY'
                ? 'bg-primary-50 border-primary-200 text-primary-700'
                : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
              {acceptTarget.delivery_method === 'TRANSPORTER_DELIVERY'
                ? <><Truck className="w-4 h-4 flex-shrink-0" /> Agent requested delivery — you will arrange transport</>
                : <><Package className="w-4 h-4 flex-shrink-0" /> Agent will self-collect from your warehouse</>}
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setAcceptTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={confirmAccept}
                disabled={accepting}
                className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {accepting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {accepting ? 'Accepting...' : 'Confirm Accept'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Post Stock Listing modal */}
      <Modal isOpen={showNoticeForm} onClose={() => { setShowNoticeForm(false); setNoticeForm(NOTICE_BLANK) }} title="Post Stock Listing">
        <form onSubmit={submitNotice} className="space-y-4">
          <p className="text-sm text-gray-500">Linked agents will see this and can place orders against it.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Crop *</label>
              <input className="input" value={noticeForm.crop_name} onChange={e => setNoticeForm(f => ({ ...f, crop_name: e.target.value }))} required placeholder="e.g. Tomatoes" />
            </div>
            <div>
              <label className="label">Qty available (kg) *</label>
              <input type="number" className="input" value={noticeForm.quantity_available_kg} onChange={e => setNoticeForm(f => ({ ...f, quantity_available_kg: e.target.value }))} required min="0.01" step="0.01" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Price/kg (RWF)</label>
              <input type="number" className="input" value={noticeForm.price_per_kg} onChange={e => setNoticeForm(f => ({ ...f, price_per_kg: e.target.value }))} min="0" placeholder="Optional" />
            </div>
            <div>
              <label className="label">Pickup location</label>
              <PlaceSearchInput
                placeholder="Search pickup location…"
                onSelect={({ address }) => setNoticeForm(f => ({ ...f, pickup_location: address }))}
              />
              {noticeForm.pickup_location && (
                <p className="text-xs text-primary-600 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {noticeForm.pickup_location}
                </p>
              )}
            </div>
          </div>
          <div>
            <label className="label">Collect by (optional)</label>
            <input type="date" className="input" value={noticeForm.available_until} onChange={e => setNoticeForm(f => ({ ...f, available_until: e.target.value }))} min={new Date().toISOString().slice(0, 10)} />
            <p className="text-xs text-gray-400 mt-1">Leave blank to keep this listing open until you close it manually. If set, agents can't collect against it after this date.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowNoticeForm(false); setNoticeForm(NOTICE_BLANK) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={noticeSaving} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {noticeSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {noticeSaving ? 'Publishing...' : 'Post Listing'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
