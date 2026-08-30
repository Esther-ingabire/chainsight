import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, Star, TrendingUp, RefreshCw, ChevronRight, CheckCircle, MapPin, Package, Truck, Award, ArrowRight, Navigation } from 'lucide-react'
import DataTable from '../../components/ui/DataTable.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { distributionApi } from '../../api/distribution.js'
import { cooperativesApi } from '../../api/cooperatives.js'
import toast from 'react-hot-toast'
import { useLocation } from 'react-router-dom'

const STATUS_LABEL = {
  PENDING:     'Pending',
  ACCEPTED:    'Accepted',
  NEGOTIATING: 'Negotiating',
  DECLINED:    'Declined',
  COMPLETED:   'Completed',
  CANCELLED:   'Cancelled',
}

// Each crop has a POOL of distinct images.
// getCropImage uses the cooperative's own ID to pick from the pool,
// so two coops with the same crop will show different images.
const CROP_POOLS = {
  maize:            ['https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=400&h=180&fit=crop'],
  corn:             ['https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=400&h=180&fit=crop'],
  tomatoes:         ['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1561136594-7f68813d8f56?w=400&h=180&fit=crop'],
  tomato:           ['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1561136594-7f68813d8f56?w=400&h=180&fit=crop'],
  potatoes:         ['https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1585164279323-bc69a7a60db6?w=400&h=180&fit=crop'],
  'sweet potatoes': ['https://images.unsplash.com/photo-1508702438698-8a7d24e2f90e?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1596097635121-14b63b7a0c19?w=400&h=180&fit=crop'],
  beans:            ['https://images.unsplash.com/photo-1506976785307-8732e854ad03?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400&h=180&fit=crop'],
  avocados:         ['https://images.unsplash.com/photo-1519162808019-7de1683fa2ad?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=400&h=180&fit=crop'],
  avocado:          ['https://images.unsplash.com/photo-1519162808019-7de1683fa2ad?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=400&h=180&fit=crop'],
  bananas:          ['https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1528825871115-3581a5387919?w=400&h=180&fit=crop'],
  banana:           ['https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1528825871115-3581a5387919?w=400&h=180&fit=crop'],
  coffee:           ['https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&h=180&fit=crop'],
  tea:              ['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400&h=180&fit=crop'],
  sorghum:          ['https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&h=180&fit=crop'],
  rice:             ['https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&h=180&fit=crop'],
  cassava:          ['https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=400&h=180&fit=crop',
                     'https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=400&h=180&fit=crop'],
}

const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=400&h=180&fit=crop',
  'https://images.unsplash.com/photo-1493770348161-369560ae357d?w=400&h=180&fit=crop',
  'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=400&h=180&fit=crop',
  'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&h=180&fit=crop',
  'https://images.unsplash.com/photo-1435373996065-9a5e9e8e5e4f?w=400&h=180&fit=crop',
  'https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=400&h=180&fit=crop',
  'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&h=180&fit=crop',
  'https://images.unsplash.com/photo-1533038590840-1cde6e668a91?w=400&h=180&fit=crop',
]

// Force a specific primary crop for cooperatives where M2M ordering
// doesn't reflect what they're best known for.
const PRIMARY_CROP_OVERRIDE = {
  101: 'coffee',   // Rubavu Farmers Union — Coffee, Bananas
}

function getCropImage(crops = [], coopId = 0) {
  const list = typeof crops === 'string'
    ? crops.split(',').map(s => s.trim())
    : (Array.isArray(crops) ? crops : [])

  // If this coop has a forced primary crop, look that up first
  const forcedKey = PRIMARY_CROP_OVERRIDE[coopId]
  if (forcedKey) {
    const pool = CROP_POOLS[forcedKey]
      || CROP_POOLS[Object.keys(CROP_POOLS).find(k => forcedKey.includes(k) || k.includes(forcedKey))]
    if (pool) return pool[Math.abs(coopId) % pool.length]
  }

  // Otherwise use the first crop's pool
  for (const c of list) {
    const key = (c?.name || c || '').toLowerCase().trim()
    const pool = CROP_POOLS[key]
      || CROP_POOLS[Object.keys(CROP_POOLS).find(k => key.includes(k) || k.includes(key))]
    if (pool) return pool[Math.abs(coopId) % pool.length]
  }
  return FALLBACK_IMAGES[Math.abs(coopId) % FALLBACK_IMAGES.length]
}

function ScoreBadge({ score }) {
  const pct = Math.round((score || 0) * 100)
  const color = pct >= 75 ? 'text-success-600 bg-success-50' : pct >= 50 ? 'text-warning-500 bg-warning-50' : 'text-gray-500 bg-gray-100'
  return <span className={`badge ${color}`}>{pct}%</span>
}

function CoopCard({ coop, onRequest, isFrequent }) {
  const imgSrc = coop.image_url || getCropImage(coop.crops_specialised, coop.id)
  const wrapperCls = isFrequent
    ? 'rounded-2xl border-2 border-warning-200 bg-warning-50/40 overflow-hidden hover:shadow-md transition-all'
    : 'rounded-2xl border-2 border-gray-200 bg-white overflow-hidden hover:shadow-md hover:border-primary-300 transition-all'
  const stockLabel = typeof coop.stock_kg === 'number' ? coop.stock_kg.toLocaleString() : coop.stock_kg
  return (
    <div className={wrapperCls}>
      <div className="w-full h-32 overflow-hidden bg-gray-100">
        <img
          src={imgSrc}
          alt={coop.crops_specialised?.[0] || 'Produce'}
          className="w-full h-full object-cover"
          onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_IMAGES[Math.abs(coop.id || 0) % FALLBACK_IMAGES.length] }}
        />
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-gray-900 text-sm leading-tight">{coop.name}</p>
          {isFrequent && <Star className="w-4 h-4 text-warning-400 fill-warning-400 flex-shrink-0" />}
        </div>
        <div className="text-xs text-gray-500 space-y-0.5">
          <p className="flex items-center gap-1"><MapPin className="w-3 h-3" />{coop.district}</p>
          <p>{coop.crops_specialised?.slice(0, 3).join(', ')}</p>
        </div>
        {coop.stock_kg && (
          <p className="text-sm font-medium text-success-600">Stock: {stockLabel} kg</p>
        )}
        <button
          onClick={() => onRequest(coop)}
          className="w-full py-2 rounded-xl text-sm font-semibold text-white bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 transition-colors mt-1">
          {isFrequent ? 'View Profile' : 'Send Request'}
        </button>
      </div>
    </div>
  )
}

export default function OrderManagement() {
  const location = useLocation()
  const initialTab = location.search.includes('coop=') ? 'cooperatives' : 'requests'
  const [tab, setTab] = useState(initialTab)
  const [orders, setOrders] = useState([])
  const [allCoops, setAllCoops] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingCoops, setLoadingCoops] = useState(false)
  const [search, setSearch] = useState('')
  const [coopSearch, setCoopSearch] = useState('')
  const [nearbyOnly, setNearbyOnly] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [coopStep, setCoopStep] = useState('profile') // 'profile' | 'order'
  const [selectedCoop, setSelectedCoop] = useState(null)
  const [form, setForm] = useState({ cooperative: '', crop_name: '', quantity_kg: '', quality_grade_required: 'A', required_delivery_date: '', additional_notes: '', delivery_method: 'TRANSPORTER_DELIVERY' })
  const [saving, setSaving] = useState(false)
  const [partnerIds, setPartnerIds] = useState(new Set())
  const [selectedOrder, setSelectedOrder] = useState(null)

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await distributionApi.getMyProduceRequests({})
      const list = res.data?.results ?? res.data ?? []
      setOrders(list)
      setPartnerIds(new Set(list.map(o => o.cooperative)))
    } catch {
      toast.error('Could not load produce requests')
    }
    finally { setLoadingOrders(false) }
  }, [])

  const loadCoops = useCallback(async (q = '', nearby = false) => {
    setLoadingCoops(true)
    try {
      const params = {}
      if (q) params.search = q
      if (nearby) params.nearby = 'true'
      const res = await cooperativesApi.searchDirectory(params)
      setAllCoops(res.data?.results ?? res.data ?? [])
    } catch {
      toast.error('Could not load cooperatives')
    }
    finally { setLoadingCoops(false) }
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])
  useEffect(() => { if (tab === 'cooperatives') loadCoops(coopSearch, nearbyOnly) }, [tab, nearbyOnly])

  const openRequest = (coop) => {
    setSelectedCoop(coop)
    setForm(f => ({ ...f, cooperative: coop.id }))
    setCoopStep('profile')
    setShowNew(true)
    // Fetch the full profile (stock records, storage facilities) in the background
    // so the modal upgrades from the lightweight directory row to real data.
    cooperativesApi.getCooperativeDetail(coop.id).then(res => {
      const full = res.data
      const stockKg = (full.stock_records || []).reduce((sum, s) => sum + Number(s.quantity_kg || 0), 0)
      // The detail endpoint's crops_specialised is a list of Crop objects ({id, name, ...}),
      // but the directory endpoint (used for the initial card data) returns plain strings —
      // normalize to strings so the profile modal doesn't try to render an object as a child.
      const cropsNames = (full.crops_specialised || []).map(c => typeof c === 'string' ? c : c.name)
      setSelectedCoop(prev => (prev && prev.id === coop.id ? { ...prev, ...full, crops_specialised: cropsNames, stock_kg: stockKg } : prev))
    }).catch(() => {})
  }

  const closeCoopModal = () => {
    setShowNew(false)
    setSelectedCoop(null)
    setCoopStep('profile')
  }

  const submitOrder = async (e) => {
    e.preventDefault()
    setSaving(true)

    const coopId = Number(form.cooperative)

    try {
      const payload = {
        cooperative: coopId,
        crop_name: form.crop_name,
        quantity_kg: Number(form.quantity_kg),
        quality_grade_required: form.quality_grade_required,
        required_delivery_date: form.required_delivery_date,
        additional_notes: form.additional_notes,
        delivery_method: form.delivery_method,
      }
      const res = await distributionApi.createProduceRequest(payload)
      setOrders(prev => [res.data, ...prev])
      toast.success('Request sent to cooperative')
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : 'Failed to place order'
      toast.error(msg)
      setSaving(false)
      return
    }

    setSaving(false)
    setShowNew(false)
    setSelectedCoop(null)
  }

  const filtered = orders
    .filter(o => statusFilter === 'all' || o.status === statusFilter)
    .filter(o => {
      const q = search.toLowerCase()
      return !q || (o.cooperative_name || '').toLowerCase().includes(q) || (o.crop_name || '').toLowerCase().includes(q)
    })

  const orderColumns = [
    { key: 'id', label: 'Request ID', render: v => <span className="font-mono text-sm text-gray-700">DIST-REQ-{String(v).padStart(3, '0')}</span> },
    { key: 'cooperative_name', label: 'Cooperative', render: (v, row) => (
      <div>
        <p className="font-medium text-sm text-gray-900">{v || '—'}</p>
        <p className="text-xs text-gray-400">Grade {row.quality_grade_required}</p>
      </div>
    )},
    { key: 'crop_name', label: 'Crop', render: v => <span className="text-sm text-gray-700">{v || '—'}</span> },
    { key: 'quantity_kg', label: 'Quantity', render: v => v ? <span className="font-medium">{Number(v).toLocaleString()} kg</span> : '—' },
    { key: 'required_delivery_date', label: 'Delivery Date', render: v => v ? new Date(v).toLocaleDateString('en-RW', { year: 'numeric', month: 'short', day: 'numeric' }) : '—' },
    { key: 'delivery_method', label: 'Delivery', render: v => (
      <span className="text-xs text-gray-500 flex items-center gap-1">
        {v === 'SELF_COLLECTION' ? <><Truck className="w-3 h-3" />Self-collect</> : <><Package className="w-3 h-3" />Coop arranges</>}
      </span>
    )},
    { key: 'status', label: 'Status', render: (v, row) => (
      <div className="space-y-1">
        <StatusBadge status={v} />
        {v === 'DECLINED' && row.cooperative_response_notes && (
          <p className="text-xs text-danger-600 bg-danger-50 rounded px-2 py-1 max-w-[200px] leading-snug">
            {row.cooperative_response_notes}
          </p>
        )}
        {v === 'NEGOTIATING' && row.cooperative_response_notes && (
          <p className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 max-w-[200px] leading-snug">
            {row.cooperative_response_notes}
          </p>
        )}
      </div>
    )},
    { key: '_actions', label: 'Actions', render: (_, row) => (
      <button
        onClick={() => setSelectedOrder(row)}
        className="text-xs font-medium text-primary-700 border border-primary-200 px-3 py-1.5 rounded-lg hover:bg-primary-50 transition-colors">
        View Agreement
      </button>
    )},
  ]

  // Frequent = cooperatives you've actually ordered from before — real data, cross-referenced
  // against the full directory so clicking one always has the same rich detail as any other.
  const frequentCoops = allCoops
    .filter(c => partnerIds.has(c.id))
    .slice(0, 4)

  // Recommended = not yet partners, sorted by score
  const recommended = allCoops
    .filter(c => !partnerIds.has(c.id))
    .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
    .slice(0, 4)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders & Cooperatives</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your produce requests and find cooperatives to order from.</p>
        </div>
        <div className="flex gap-2">
          {tab === 'requests' && (
            <button onClick={() => { setSelectedCoop(null); setCoopStep('order'); setShowNew(true) }} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Request
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { id: 'requests', label: 'My Produce Requests' },
          { id: 'cooperatives', label: 'Find Cooperatives' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── My Produce Requests ── */}
      {tab === 'requests' && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 py-1.5 text-sm" placeholder="Search cooperative or crop…" />
            </div>
            <div className="flex gap-1 flex-wrap">
              {['all', 'PENDING', 'ACCEPTED', 'NEGOTIATING', 'DECLINED', 'COMPLETED', 'CANCELLED'].map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${statusFilter === f ? 'bg-primary-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {f === 'all' ? 'All' : STATUS_LABEL[f]}
                </button>
              ))}
            </div>
            <button onClick={loadOrders} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {loadingOrders
            ? <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            : <DataTable columns={orderColumns} data={filtered} emptyMessage="No produce requests yet. Go to 'Find Cooperatives' to place one." />
          }
        </div>
      )}

      {/* ── Find Cooperatives ── */}
      {tab === 'cooperatives' && (
        <div className="space-y-8">
          {/* Frequent Cooperatives (starred, card design) */}
          {frequentCoops.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-5 h-5 text-warning-400 fill-warning-400" />
                <h2 className="text-base font-semibold text-gray-900">Frequent Cooperatives</h2>
                <span className="text-xs text-gray-400">Partners you've worked with before</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {frequentCoops.map(coop => (
                  <CoopCard key={coop.id} coop={coop} onRequest={openRequest} isFrequent />
                ))}
              </div>
            </section>
          )}

          {/* Recommended / Highly Rated */}
          {recommended.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-primary-600" />
                <h2 className="text-base font-semibold text-gray-900">Highly Rated Cooperatives</h2>
                <span className="text-xs text-gray-400">Recommended based on performance scores</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {recommended.map(coop => (
                  <CoopCard key={coop.id} coop={coop} onRequest={openRequest} isFrequent={false} />
                ))}
              </div>
            </section>
          )}

          {/* Browse All */}
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-4">Browse All Cooperatives</h2>
            <form onSubmit={e => { e.preventDefault(); loadCoops(coopSearch, nearbyOnly) }} className="flex gap-2 mb-5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={coopSearch} onChange={e => setCoopSearch(e.target.value)} className="input pl-9" placeholder="Search by name, district, or crop…" />
              </div>
              <button type="submit" className="btn-primary px-5">Search</button>
              <button
                type="button"
                onClick={() => setNearbyOnly(v => !v)}
                className={`px-4 rounded-xl text-sm font-medium border flex items-center gap-1.5 transition-colors ${nearbyOnly ? 'bg-primary-500 text-white border-primary-500' : 'btn-secondary'}`}>
                <Navigation className="w-3.5 h-3.5" /> Near Me
              </button>
              <button type="button" onClick={() => { setCoopSearch(''); loadCoops('', nearbyOnly) }} className="btn-secondary px-4">
                <RefreshCw className="w-4 h-4" />
              </button>
            </form>

            {loadingCoops ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="card h-24 animate-pulse bg-gray-50" />)}</div>
            ) : allCoops.length === 0 ? (
              <div className="card py-12 text-center text-gray-400">No cooperatives found. Try a different search term.</div>
            ) : (
              <div className="space-y-3">
                {allCoops.map((coop, idx) => (
                  <div key={coop.id}
                    className={`card flex items-center gap-5 cursor-pointer hover:border-primary-200 hover:shadow-md transition-all ${partnerIds.has(coop.id) ? 'border-success-200' : ''}`}
                    onClick={() => openRequest(coop)}>
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm bg-primary-50 text-primary-700">
                      #{idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{coop.name}</p>
                        {partnerIds.has(coop.id) && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-success-50 text-success-600 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Previous partner
                          </span>
                        )}
                        {idx === 0 && !partnerIds.has(coop.id) && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-50 text-warning-600 flex items-center gap-1">
                            <Star className="w-3 h-3 fill-warning-400 text-warning-400" /> Top rated
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
                        {coop.district}{coop.sector ? ` · ${coop.sector}` : ''}
                        {coop.distance_km != null && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                            {coop.distance_km} km away
                          </span>
                        )}
                      </p>
                      {coop.crops_specialised?.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-1.5">
                          {coop.crops_specialised.slice(0, 4).map(c => (
                            <span key={c} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right space-y-1">
                      {coop.composite_score != null && <ScoreBadge score={coop.composite_score} />}
                      <p className="text-xs text-gray-400">{coop.total_batches_dispatched || 0} batches</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Cooperative profile → order modal */}
      <Modal isOpen={showNew} onClose={closeCoopModal}
        title={coopStep === 'profile' ? 'Cooperative Profile' : selectedCoop ? `Order from ${selectedCoop.name}` : 'New Produce Request'}>

        {coopStep === 'profile' && selectedCoop && (() => {
          const imgSrc = selectedCoop.image_url || getCropImage(selectedCoop.crops_specialised, selectedCoop.id)
          const score = Math.round((selectedCoop.composite_score || 0) * 100)
          const scoreColor = score >= 75 ? 'text-success-600' : score >= 50 ? 'text-warning-500' : 'text-gray-500'
          const crops = typeof selectedCoop.crops_specialised === 'string'
            ? selectedCoop.crops_specialised.split(',').map(s => s.trim())
            : (selectedCoop.crops_specialised || [])
          return (
            <div className="space-y-4">
              {/* Hero image */}
              <div className="w-full h-40 rounded-xl overflow-hidden bg-gray-100 -mt-1">
                <img src={imgSrc} alt={crops[0]} className="w-full h-full object-cover"
                  onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_IMAGES[Math.abs(selectedCoop.id || 0) % FALLBACK_IMAGES.length] }} />
              </div>

              {/* Name & location */}
              <div>
                <h3 className="text-lg font-bold text-gray-900">{selectedCoop.name}</h3>
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3.5 h-3.5" />{selectedCoop.district}{selectedCoop.sector ? `, ${selectedCoop.sector}` : ''}
                </p>
                {selectedCoop.registration_number && (
                  <p className="text-xs text-gray-400 mt-0.5">Reg. No. {selectedCoop.registration_number}</p>
                )}
              </div>

              {selectedCoop.description && (
                <p className="text-sm text-gray-600 leading-relaxed">{selectedCoop.description}</p>
              )}

              {/* Contact & management */}
              {(selectedCoop.manager_name || selectedCoop.contact_phone || selectedCoop.contact_email) && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm">
                  {selectedCoop.manager_name && (
                    <div className="flex justify-between"><span className="text-gray-500">Manager</span><span className="font-medium text-gray-900">{selectedCoop.manager_name}</span></div>
                  )}
                  {selectedCoop.contact_phone && (
                    <div className="flex justify-between"><span className="text-gray-500">Phone</span><span className="font-medium text-gray-900">{selectedCoop.contact_phone}</span></div>
                  )}
                  {selectedCoop.contact_email && (
                    <div className="flex justify-between"><span className="text-gray-500">Email</span><span className="font-medium text-gray-900">{selectedCoop.contact_email}</span></div>
                  )}
                  {selectedCoop.storage_facilities?.length > 0 && (
                    <div className="flex justify-between"><span className="text-gray-500">Storage facilities</span><span className="font-medium text-gray-900">{selectedCoop.storage_facilities.length}</span></div>
                  )}
                </div>
              )}

              {/* Crops */}
              <div className="flex flex-wrap gap-2">
                {crops.map(c => (
                  <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                    <Package className="w-3 h-3" />{c}
                  </span>
                ))}
              </div>

              {/* Per-crop stock breakdown — a cooperative may carry several products at once */}
              {selectedCoop.stock_records?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Available stock by crop</p>
                  <div className="space-y-1.5">
                    {selectedCoop.stock_records.filter(s => s.is_available).map(s => (
                      <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium text-gray-900">{s.crop_name || s.crop?.name || s.crop}</span>
                        <span className="text-gray-600">{Number(s.quantity_kg).toLocaleString()} kg <span className="text-gray-400">· Grade {s.quality_grade}</span></span>
                      </div>
                    ))}
                    {selectedCoop.stock_records.every(s => !s.is_available) && (
                      <p className="text-xs text-gray-400">No stock currently marked available for requests.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Performance stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold ${scoreColor}`}>{score}%</p>
                  <p className="text-xs text-gray-500 mt-0.5">Performance</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{selectedCoop.total_batches_dispatched ?? '—'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Batches sent</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-success-600">
                    {typeof selectedCoop.stock_kg === 'number' ? `${selectedCoop.stock_kg.toLocaleString()} kg` : '—'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Stock available</p>
                </div>
              </div>

              {/* Score breakdown */}
              {selectedCoop.reliability_score != null && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Score breakdown</p>
                  {[
                    { label: 'Reliability', value: selectedCoop.reliability_score },
                    { label: 'Quality consistency', value: selectedCoop.quality_consistency_rate },
                    { label: 'Response rate', value: selectedCoop.response_rate },
                    { label: 'On-time dispatch', value: selectedCoop.on_time_dispatch_rate },
                  ].map(({ label, value }) => value != null && (
                    <div key={label} className="flex items-center gap-3">
                      <p className="text-xs text-gray-500 w-36 flex-shrink-0">{label}</p>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-400 rounded-full" style={{ width: `${Math.round(value * 100)}%` }} />
                      </div>
                      <p className="text-xs font-medium text-gray-700 w-8 text-right">{Math.round(value * 100)}%</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={closeCoopModal} className="btn-secondary flex-1">Close</button>
                <button onClick={() => setCoopStep('order')} className="btn-primary flex-1 flex items-center justify-center gap-2">
                  Place Order <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })()}

        {coopStep === 'order' && (
          <form onSubmit={submitOrder} className="space-y-4">
            {selectedCoop ? (
              <div className="bg-primary-50 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-primary-800 text-sm">{selectedCoop.name}</p>
                  <p className="text-xs text-primary-600 mt-0.5">{selectedCoop.district}</p>
                </div>
                <button type="button" onClick={() => setCoopStep('profile')} className="text-xs text-primary-600 hover:underline">View profile</button>
              </div>
            ) : (
              <div>
                <label className="label">Cooperative *</label>
                <select className="input" value={form.cooperative} onChange={e => setForm(f => ({ ...f, cooperative: e.target.value }))} required>
                  <option value="">Select cooperative…</option>
                  {allCoops.map(c => <option key={c.id} value={c.id}>{c.name} — {c.district}</option>)}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Crop</label>
                <input className="input" value={form.crop_name} onChange={e => setForm(f => ({ ...f, crop_name: e.target.value }))} placeholder="e.g. Coffee" />
              </div>
              <div>
                <label className="label">Grade required</label>
                <select className="input" value={form.quality_grade_required} onChange={e => setForm(f => ({ ...f, quality_grade_required: e.target.value }))}>
                  <option value="A">Grade A</option>
                  <option value="B">Grade B</option>
                  <option value="C">Grade C</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Quantity (kg) *</label>
                <input type="number" className="input" value={form.quantity_kg} onChange={e => setForm(f => ({ ...f, quantity_kg: e.target.value }))} required min="0.01" step="0.01" />
              </div>
              <div>
                <label className="label">Delivery deadline *</label>
                <input type="date" className="input" value={form.required_delivery_date} onChange={e => setForm(f => ({ ...f, required_delivery_date: e.target.value }))} required min={new Date().toISOString().slice(0, 10)} />
              </div>
            </div>
            <div>
              <label className="label">Additional notes</label>
              <textarea className="input" rows={2} value={form.additional_notes} onChange={e => setForm(f => ({ ...f, additional_notes: e.target.value }))} placeholder="Any special requirements…" />
            </div>
            <div>
              <label className="label">Delivery method</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setForm(f => ({ ...f, delivery_method: 'SELF_COLLECTION' }))}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    form.delivery_method === 'SELF_COLLECTION'
                      ? 'bg-primary-50 border-primary-300 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  <Truck className="w-4 h-4 flex-shrink-0" /> I'll collect it myself
                </button>
                <button type="button" onClick={() => setForm(f => ({ ...f, delivery_method: 'TRANSPORTER_DELIVERY' }))}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    form.delivery_method === 'TRANSPORTER_DELIVERY'
                      ? 'bg-primary-50 border-primary-300 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  <Package className="w-4 h-4 flex-shrink-0" /> Cooperative arranges transport
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {form.delivery_method === 'SELF_COLLECTION'
                  ? "You'll send your own vehicle to pick up the produce."
                  : 'The cooperative will hire a transporter to deliver to your warehouse.'}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={closeCoopModal} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* View Agreement modal */}
      <Modal isOpen={!!selectedOrder} onClose={() => setSelectedOrder(null)} title="Produce Request Agreement">
        {selectedOrder && (() => {
          const o = selectedOrder
          const statusColors = {
            PENDING:     'bg-warning-50 text-warning-700 border-warning-200',
            ACCEPTED:    'bg-success-50 text-success-700 border-success-200',
            NEGOTIATING: 'bg-blue-50 text-blue-700 border-blue-200',
            DECLINED:    'bg-danger-50 text-danger-700 border-danger-200',
            COMPLETED:   'bg-primary-50 text-primary-700 border-primary-200',
            CANCELLED:   'bg-gray-100 text-gray-500 border-gray-200',
          }
          const statusCls = statusColors[o.status] || 'bg-gray-100 text-gray-600 border-gray-200'
          return (
            <div className="space-y-5">
              {/* Status banner */}
              <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${statusCls}`}>
                <span className="text-sm font-semibold">Request Status</span>
                <span className="text-sm font-bold uppercase tracking-wide">{o.status?.replace(/_/g, ' ')}</span>
              </div>

              {/* Reference */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Reference No.</span>
                <span className="font-mono font-semibold text-gray-900">DIST-REQ-{String(o.id).padStart(3, '0')}</span>
              </div>

              <hr className="border-gray-100" />

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Cooperative</p>
                  <p className="font-semibold text-gray-900">{o.cooperative_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Crop Requested</p>
                  <p className="font-semibold text-gray-900">{o.crop_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Quantity</p>
                  <p className="font-semibold text-gray-900">
                    {o.quantity_kg ? `${Number(o.quantity_kg).toLocaleString()} kg` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Quality Grade</p>
                  <p className="font-semibold text-gray-900">Grade {o.quality_grade_required || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Delivery deadline</p>
                  <p className="font-semibold text-gray-900">
                    {o.required_delivery_date ? new Date(o.required_delivery_date).toLocaleDateString('en-RW', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Date Placed</p>
                  <p className="font-semibold text-gray-900">
                    {o.created_at ? new Date(o.created_at).toLocaleDateString('en-RW', { year: 'numeric', month: 'long', day: 'numeric' }) : 'June 12, 2026'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Delivery method</p>
                  <p className="font-semibold text-gray-900 flex items-center gap-1.5">
                    {o.delivery_method === 'SELF_COLLECTION'
                      ? <><Truck className="w-3.5 h-3.5 text-gray-400" />You collect</>
                      : <><Package className="w-3.5 h-3.5 text-gray-400" />Cooperative arranges</>}
                  </p>
                </div>
              </div>

              {/* Cooperative's response — shown for DECLINED and NEGOTIATING */}
              {o.cooperative_response_notes && (
                <>
                  <hr className="border-gray-100" />
                  <div className={`rounded-xl px-4 py-3 border ${
                    o.status === 'DECLINED'
                      ? 'bg-danger-50 border-danger-200'
                      : o.status === 'NEGOTIATING'
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <p className={`text-xs font-semibold mb-1 ${
                      o.status === 'DECLINED' ? 'text-danger-600'
                      : o.status === 'NEGOTIATING' ? 'text-blue-600'
                      : 'text-gray-500'
                    }`}>
                      {o.status === 'DECLINED' ? 'Reason for declining' : o.status === 'NEGOTIATING' ? "Cooperative's counter-proposal" : "Cooperative's response"}
                    </p>
                    <p className="text-sm text-gray-700">{o.cooperative_response_notes}</p>
                  </div>
                </>
              )}

              {o.additional_notes && (
                <>
                  <hr className="border-gray-100" />
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Your notes</p>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3">{o.additional_notes}</p>
                  </div>
                </>
              )}

              <button onClick={() => setSelectedOrder(null)} className="btn-secondary w-full">Close</button>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
