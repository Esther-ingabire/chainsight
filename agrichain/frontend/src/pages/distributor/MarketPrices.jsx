import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, TrendingDown, Search, RefreshCw, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { marketAgentApi } from '../../api/marketAgent.js'
import { formatDistanceToNow } from 'date-fns'

export default function MarketPrices() {
  const [search, setSearch] = useState('')
  const [prices, setPrices] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    marketAgentApi.getNationalPrices()
      .then(res => setPrices(res.data?.results ?? res.data ?? []))
      .catch(() => toast.error('Could not load market prices'))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = prices.filter(p =>
    p.crop_name.toLowerCase().includes(search.toLowerCase()) ||
    p.market_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Market Prices</h1>
          <p className="text-sm text-gray-500 mt-0.5">Live market prices from agents across Rwanda.</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 text-sm" placeholder="Search crop or market…" />
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filtered.map(p => {
            const price = Number(p.price_per_kg)
            const prev = p.prev_price != null ? Number(p.prev_price) : null
            const change = prev ? ((price - prev) / prev * 100) : null
            const isUp = change > 0
            const isFlat = change === 0
            return (
              <div key={p.id} className="card flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{p.crop_name}</p>
                  <p className="text-xs text-gray-500">Grade {p.quality_grade} · {p.market_name}</p>
                  <p className="text-xs text-gray-400 mt-1">Updated {formatDistanceToNow(new Date(p.recorded_at), { addSuffix: true })}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-gray-900">RWF {price.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">per kg</p>
                  {change !== null && !isFlat && (
                    <div className={`flex items-center justify-end gap-0.5 text-xs font-medium mt-1 ${isUp ? 'text-success-500' : 'text-danger-500'}`}>
                      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {isUp ? '+' : ''}{change.toFixed(1)}%
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card text-center py-10 text-gray-400">
          <p>{search ? `No prices found for "${search}"` : 'No prices recorded yet.'}</p>
        </div>
      )}
    </div>
  )
}
