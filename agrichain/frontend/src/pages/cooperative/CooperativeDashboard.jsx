import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Package, Inbox, Truck, Thermometer, AlertTriangle, MapPin, Star, Snowflake, CheckCircle, XCircle, Trophy } from 'lucide-react'
import KPICard from '../../components/ui/KPICard.jsx'
import DeclineReasonPicker from '../../components/ui/DeclineReasonPicker.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { cooperativesApi } from '../../api/cooperatives.js'
import { distributionApi } from '../../api/distribution.js'
import { transportApi } from '../../api/transport.js'
import toast from 'react-hot-toast'

function StarRow({ rating }) {
  const full = Math.floor(rating)
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={`w-3 h-3 ${i <= full ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 fill-gray-300'}`} />
      ))}
      <span className="text-xs text-gray-500 ml-1">{rating}</span>
    </span>
  )
}

function BestCropCard({ cropPerf, loading }) {
  if (loading) return <div className="card h-32 animate-pulse bg-gray-50" />

  const best = cropPerf?.best_crop
  const rest = (cropPerf?.crops || []).slice(1, 4)

  if (!best) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-5 h-5 text-gray-300" />
          <h2 className="font-semibold text-gray-900">Your Best Performer</h2>
        </div>
        <p className="text-sm text-gray-400 py-2">No batches dispatched in the last 90 days yet — this fills in once you start dispatching.</p>
      </div>
    )
  }

  return (
    <div className="card border-2 border-success-500">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="w-5 h-5 text-success-600" />
        <h2 className="font-semibold text-gray-900">Your Best Performer — Last 90 Days</h2>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xl font-bold text-gray-900">{best.crop_name}</p>
          <p className="text-sm text-gray-500 mt-0.5">
            {best.total_kg.toLocaleString()} kg dispatched across {best.batch_count} batch{best.batch_count !== 1 ? 'es' : ''}
            {best.distinct_distributors > 0 && ` · ${best.distinct_distributors} distributor${best.distinct_distributors !== 1 ? 's' : ''} buying`}
          </p>
          <p className="text-xs text-gray-400 mt-1">This is what you're moving the most — worth focusing effort here rather than spreading thin.</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">Avg loss</p>
          <p className={`text-lg font-bold ${best.avg_loss_pct > 10 ? 'text-danger-600' : 'text-success-600'}`}>{best.avg_loss_pct}%</p>
        </div>
      </div>
      {rest.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Also moving</p>
          {rest.map(c => (
            <div key={c.crop_id} className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{c.crop_name}</span>
              <span className="text-gray-400">{c.total_kg.toLocaleString()} kg</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StorageGauge({ facility, reading }) {
  const temp = reading?.temperature_celsius ?? null
  const threshold = facility.temp_threshold_amber_celsius ?? 15
  const isWarning = temp !== null && temp > threshold
  const pct = temp !== null ? Math.min(100, (temp / 30) * 100) : 0

  return (
    <div className="p-4 bg-gray-50 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-700">{facility.name}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isWarning ? 'bg-warning-50 text-warning-500' : 'bg-success-50 text-success-500'}`}>
          {isWarning ? 'Warning' : 'Normal'}
        </span>
      </div>
      {temp !== null ? (
        <div className="flex items-end gap-4">
          <div>
            <p className="text-3xl font-bold text-gray-900">{temp}°C</p>
            <p className="text-xs text-gray-500 mt-0.5">Humidity: {reading?.humidity_percent ?? '—'}%</p>
          </div>
          <div className="flex-1 pb-1">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className={`h-2 rounded-full transition-all ${isWarning ? 'bg-warning-500' : 'bg-success-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">Threshold: {threshold}°C</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 mt-2">No sensor reading available</p>
      )}
    </div>
  )
}

export default function CooperativeDashboard() {
  const { user } = useAuth()
  const [cooperative, setCooperative] = useState(null)
  const [stockItems, setStockItems] = useState([])
  const [facilities, setFacilities] = useState([])
  const [iotReadings, setIotReadings] = useState([])
  const [trips, setTrips] = useState([])
  const [pendingRequests, setPendingRequests] = useState([])
  const [cropPerf, setCropPerf] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      cooperativesApi.getMyCooperative(),
      cooperativesApi.getMyFacilities(),
      cooperativesApi.getStorageReadings(),
      transportApi.getMyRequests({ status: 'IN_PROGRESS' }),
      distributionApi.getMyProduceRequests({ status: 'PENDING' }),
      cooperativesApi.getMyStock(),
      cooperativesApi.getCropPerformance(),
    ]).then(([coopRes, facRes, iotRes, tripsRes, reqRes, stockRes, cropRes]) => {
      if (coopRes.status === 'fulfilled') setCooperative(coopRes.value.data || null)
      setFacilities(facRes.status === 'fulfilled' ? (facRes.value.data?.results ?? facRes.value.data ?? []) : [])
      setIotReadings(iotRes.status === 'fulfilled' ? (iotRes.value.data?.results ?? iotRes.value.data ?? []) : [])
      setTrips(tripsRes.status === 'fulfilled' ? (tripsRes.value.data?.results ?? tripsRes.value.data ?? []) : [])
      setPendingRequests(reqRes.status === 'fulfilled' ? (reqRes.value.data?.results ?? reqRes.value.data ?? []) : [])
      setStockItems(stockRes.status === 'fulfilled' ? (stockRes.value.data?.results ?? stockRes.value.data ?? []) : [])
      setCropPerf(cropRes.status === 'fulfilled' ? cropRes.value.data : null)
    }).finally(() => setLoading(false))
  }, [])

  const latestByFacility = iotReadings.reduce((acc, r) => {
    if (!acc[r.facility] || new Date(r.timestamp) > new Date(acc[r.facility].timestamp)) acc[r.facility] = r
    return acc
  }, {})

  const [decliningReqId, setDecliningReqId] = useState(null)

  const handleQuickAction = async (requestId, action, reason = '') => {
    try {
      if (action === 'accept') {
        await distributionApi.acceptProduceRequest(requestId, {})
      } else {
        await distributionApi.declineProduceRequest(requestId, { notes: reason || 'Declined' })
      }
      setPendingRequests(prev => prev.filter(r => r.id !== requestId))
      toast.success(`Request ${action === 'accept' ? 'accepted' : 'declined'}`)
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : `Failed to ${action} request`
      toast.error(msg)
    }
  }

  const stockKg = stockItems
    .filter(s => s.is_available)
    .reduce((a, s) => a + Number(s.quantity_kg), 0)

  const reliabilityScore = cooperative?.reliability_score ?? null

  const storageAlerts = facilities.filter(f => {
    const r = latestByFacility[f.id]
    return r && (r.is_temperature_breach || r.is_humidity_breach)
  })

  return (
    <div className="space-y-6">
      {/* Profile banner */}
      <div className="card bg-gradient-to-r from-primary-700 to-primary-600 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-primary-200 text-sm">Cooperative</p>
            <h1 className="text-2xl font-bold mt-0.5">{cooperative?.name || user?.organization_name || 'My Cooperative'}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-primary-200">
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {cooperative?.district || user?.district || 'District'}
              </span>
              {reliabilityScore !== null && Number(reliabilityScore) > 0 && (
                <span className="flex items-center gap-1">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} className={`w-3.5 h-3.5 ${i <= Math.round(reliabilityScore) ? 'text-yellow-300 fill-yellow-300' : 'text-primary-400'}`} />
                  ))}
                  <span className="ml-1">{reliabilityScore} reliability</span>
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-primary-200 text-xs">Total stock available</p>
            <p className="text-3xl font-bold">{loading ? '…' : stockKg.toLocaleString()} kg</p>
            <p className="text-primary-300 text-xs mt-0.5">
              {stockItems.filter(s => s.is_available).length} batches
            </p>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Stock Available" value={loading ? '…' : `${stockKg.toLocaleString()} kg`} icon={Package} color="primary" />
        <KPICard title="Produce Requests" value={loading ? '…' : pendingRequests.length} icon={Inbox} color="warning" />
        <KPICard title="Batches in Transit" value={loading ? '…' : trips.length} icon={Truck} color="primary" />
        <KPICard title="Storage Status" value={loading ? '…' : storageAlerts.length ? storageAlerts.length : 'OK'} icon={Thermometer} color={storageAlerts.length > 0 ? 'warning' : 'success'} />
      </div>

      <BestCropCard cropPerf={cropPerf} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Incoming requests */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Incoming Produce Requests</h2>
            <Link to="/cooperative/produce-requests" className="text-sm text-primary-600 hover:underline">View all</Link>
          </div>
          {loading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
          ) : pendingRequests.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No pending requests</p>
          ) : (
            <div className="space-y-3">
              {pendingRequests.slice(0, 3).map(req => (
                <div key={req.id} className="p-3 bg-gray-50 rounded-xl flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">{req.distributor_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {req.crop_name} · {Number(req.quantity_kg).toLocaleString()} kg · Grade {req.quality_grade_required} · Due {req.required_delivery_date}
                    </p>
                    {req.rating && <StarRow rating={req.rating} />}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleQuickAction(req.id, 'accept')}
                      className="flex items-center gap-1 px-2.5 py-1 bg-primary-500 text-white text-xs font-medium rounded-lg hover:bg-primary-600 transition-colors"
                    >
                      <CheckCircle className="w-3 h-3" /> Accept
                    </button>
                    <button
                      onClick={() => setDecliningReqId(req.id)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white text-danger-500 border border-danger-200 text-xs font-medium rounded-lg hover:bg-danger-50 transition-colors"
                    >
                      <XCircle className="w-3 h-3" /> Decline
                    </button>
                  </div>
                  {decliningReqId === req.id && (
                    <div className="mt-2">
                      <DeclineReasonPicker
                        quickReasons={['Crop not in season', 'Stock insufficient', 'Quality grade unavailable', 'Delivery date not feasible']}
                        onConfirm={reason => { setDecliningReqId(null); handleQuickAction(req.id, 'decline', reason) }}
                        onCancel={() => setDecliningReqId(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Storage conditions */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Storage Conditions</h2>
            <Link to="/cooperative/storage" className="text-sm text-primary-600 hover:underline">Full analytics</Link>
          </div>
          {loading ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
          ) : facilities.length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              <Thermometer className="w-8 h-8 mx-auto mb-2 text-gray-200" />
              <p className="text-sm">No storage facilities registered yet.</p>
              <Link to="/cooperative/storage" className="text-xs text-primary-600 hover:underline mt-1 inline-block">Add a facility</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {facilities.slice(0, 2).map(f => (
                <StorageGauge key={f.id} facility={f} reading={latestByFacility[f.id]} />
              ))}
            </div>
          )}
          {storageAlerts.length > 0 && (
            <div className="mt-3 p-3 bg-warning-50 rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-warning-500">
                {storageAlerts.map(f => f.name).join(', ')} is above the Amber threshold. Monitor closely and reduce entry/exit cycles.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Active shipments */}
      {trips.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Active Shipments</h2>
            <Link to="/cooperative/transport" className="text-sm text-primary-600 hover:underline">All requests</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500 border-b">
                <tr>
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Cargo</th>
                  <th className="pb-2 pr-4">Route</th>
                  <th className="pb-2 pr-4">Transporter</th>
                  <th className="pb-2">Cold Chain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {trips.slice(0, 5).map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-mono text-xs text-primary-600">#{t.id}</td>
                    <td className="py-2.5 pr-4 font-medium">{t.cargo_description || '—'}</td>
                    <td className="py-2.5 pr-4 text-gray-500 text-xs">{t.pickup_location} → {t.destination}</td>
                    <td className="py-2.5 pr-4 text-gray-600">{t.transporter_name || 'Unassigned'}</td>
                    <td className="py-2.5">
                      {t.requires_refrigeration
                        ? <span className="inline-flex items-center gap-1 text-xs text-info-600 bg-info-50 px-2 py-0.5 rounded-full ring-1 ring-info-100"><Snowflake className="w-3 h-3" />Cold chain</span>
                        : <span className="text-xs text-gray-400">Standard</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
