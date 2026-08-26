import { useState, useEffect, useCallback } from 'react'
import { Thermometer, Droplets, AlertTriangle, CheckCircle, RefreshCw, Database, Wifi } from 'lucide-react'
import KPICard from '../../components/ui/KPICard.jsx'
import { cooperativesApi } from '../../api/cooperatives.js'

function FacilityCard({ facility, reading }) {
  const temp = reading?.temperature_celsius ?? null
  const humidity = reading?.humidity_percent ?? null
  const threshold = facility.temp_threshold_amber_celsius ?? 15
  const isBreach  = reading?.is_temperature_breach || reading?.is_humidity_breach
  const isWarning = temp !== null && temp > threshold

  const borderColor = isBreach ? 'border-danger-500' : isWarning ? 'border-warning-500' : 'border-success-500'

  return (
    <div className={`card border-2 ${borderColor}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-semibold text-gray-900">{facility.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {facility.location_description || '—'} · {facility.has_iot_sensor ? 'IoT sensor active' : 'No sensor'}
          </p>
        </div>
        {isBreach
          ? <span className="flex items-center gap-1 text-xs font-medium text-danger-500 bg-danger-50 px-2 py-1 rounded-full"><AlertTriangle className="w-3 h-3" />Breach</span>
          : isWarning
          ? <span className="flex items-center gap-1 text-xs font-medium text-warning-500 bg-warning-50 px-2 py-1 rounded-full"><AlertTriangle className="w-3 h-3" />Warning</span>
          : <span className="flex items-center gap-1 text-xs font-medium text-success-600 bg-success-50 px-2 py-1 rounded-full"><CheckCircle className="w-3 h-3" />Normal</span>
        }
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="flex items-center gap-1 text-gray-500 text-xs mb-1">
            <Thermometer className="w-3 h-3" /> Temperature
          </div>
          {temp !== null
            ? <p className={`text-2xl font-bold ${isBreach ? 'text-danger-500' : isWarning ? 'text-warning-500' : 'text-gray-900'}`}>{temp}°C</p>
            : <p className="text-lg font-semibold text-gray-400">—</p>
          }
          <p className="text-xs text-gray-400 mt-0.5">Threshold: {threshold}°C</p>
        </div>

        <div className="bg-gray-50 rounded-xl p-3">
          <div className="flex items-center gap-1 text-gray-500 text-xs mb-1">
            <Droplets className="w-3 h-3" /> Humidity
          </div>
          {humidity !== null
            ? <p className="text-2xl font-bold text-gray-900">{humidity}%</p>
            : <p className="text-lg font-semibold text-gray-400">—</p>
          }
          <p className="text-xs text-gray-400 mt-0.5">Target: 60–75%</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>Capacity: {(facility.capacity_kg || 0).toLocaleString()} kg</span>
        {reading?.timestamp && (
          <span>Last reading: {new Date(reading.timestamp).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  )
}

export default function StorageAnalytics() {
  const [facilities, setFacilities] = useState([])
  const [readings, setReadings] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const [facRes, iotRes] = await Promise.all([
        cooperativesApi.getMyFacilities(),
        cooperativesApi.getStorageReadings(),
      ])
      setFacilities(facRes.data?.results ?? facRes.data ?? [])
      setReadings(iotRes.data?.results ?? iotRes.data ?? [])
    } catch {
      // Leave whatever was last successfully loaded in place rather than clearing it —
      // a single failed poll shouldn't blank out real data that's still on screen.
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll for fresh readings every 10s so breaches/temperature show up live without a manual refresh.
  useEffect(() => {
    const interval = setInterval(() => load(), 10000)
    return () => clearInterval(interval)
  }, [load])

  const latestByFacility = readings.reduce((acc, r) => {
    if (!acc[r.facility] || new Date(r.timestamp) > new Date(acc[r.facility].timestamp)) {
      acc[r.facility] = r
    }
    return acc
  }, {})

  const breachCount  = facilities.filter(f => {
    const r = latestByFacility[f.id]
    return r && (r.is_temperature_breach || r.is_humidity_breach)
  }).length
  const warningCount = facilities.filter(f => {
    const r = latestByFacility[f.id]
    return r && !r.is_temperature_breach && !r.is_humidity_breach && r.temperature_celsius > (f.temp_threshold_amber_celsius ?? 15)
  }).length
  const iotCount     = facilities.filter(f => f.has_iot_sensor).length
  const totalCapacity = facilities.reduce((acc, f) => acc + Number(f.capacity_kg || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Storage Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">IoT monitoring for cold storage and dry store facilities.</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Facilities" value={loading ? '…' : facilities.length} icon={Database} color="primary" />
        <KPICard title="IoT Sensors Active" value={loading ? '…' : iotCount} icon={Wifi} color="success" />
        <KPICard title="Total Capacity" value={loading ? '…' : `${totalCapacity.toLocaleString()} kg`} icon={Database} color="primary" />
        <KPICard
          title={breachCount > 0 ? 'Breach Alerts' : warningCount > 0 ? 'Warnings' : 'All Normal'}
          value={loading ? '…' : breachCount > 0 ? breachCount : warningCount > 0 ? warningCount : '✓'}
          icon={breachCount > 0 || warningCount > 0 ? AlertTriangle : CheckCircle}
          color={breachCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* Breach alert banner */}
      {!loading && breachCount > 0 && (
        <div className="p-4 bg-danger-50 border border-danger-200 rounded-xl flex items-start gap-3 text-danger-600">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">Breach detected</p>
            <p className="text-sm mt-0.5">
              {facilities.filter(f => { const r = latestByFacility[f.id]; return r && (r.is_temperature_breach || r.is_humidity_breach) }).map(f => f.name).join(', ')} {breachCount === 1 ? 'has exceeded' : 'have exceeded'} safe limits. Check cooling systems immediately.
            </p>
          </div>
        </div>
      )}

      {!loading && warningCount > 0 && breachCount === 0 && (
        <div className="p-4 bg-warning-50 border border-warning-200 rounded-xl flex items-start gap-3 text-warning-600">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">Temperature warning</p>
            <p className="text-sm mt-0.5">
              {facilities.filter(f => { const r = latestByFacility[f.id]; return r && r.temperature_celsius > (f.temp_threshold_amber_celsius ?? 15) }).map(f => f.name).join(', ')} {warningCount === 1 ? 'is approaching' : 'are approaching'} the safe threshold.
            </p>
          </div>
        </div>
      )}

      {/* Facility cards */}
      {loading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading facility data…</div>
      ) : facilities.length === 0 ? (
        <div className="card py-12 text-center text-gray-400 text-sm">
          No storage facilities registered. Contact your administrator to add facilities.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {facilities.map(f => (
            <FacilityCard key={f.id} facility={f} reading={latestByFacility[f.id]} />
          ))}
        </div>
      )}

      {/* Recent IoT readings table */}
      {!loading && readings.length > 0 && (
        <div className="card">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Recent IoT readings</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="pb-2 pr-4 font-medium">Facility</th>
                  <th className="pb-2 pr-4 font-medium text-right">Temp (°C)</th>
                  <th className="pb-2 pr-4 font-medium text-right">Humidity (%)</th>
                  <th className="pb-2 pr-4 font-medium text-right">Time</th>
                  <th className="pb-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {readings.slice(0, 20).map(r => (
                  <tr key={r.id}>
                    <td className="py-2.5 pr-4 text-gray-700 font-medium">{r.facility_name || `Facility ${r.facility}`}</td>
                    <td className={`py-2.5 pr-4 text-right font-semibold ${r.is_temperature_breach ? 'text-danger-500' : 'text-gray-900'}`}>{r.temperature_celsius}</td>
                    <td className={`py-2.5 pr-4 text-right font-semibold ${r.is_humidity_breach ? 'text-warning-500' : 'text-gray-900'}`}>{r.humidity_percent ?? '—'}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-400 text-xs">{new Date(r.timestamp).toLocaleTimeString()}</td>
                    <td className="py-2.5 text-right">
                      {(r.is_temperature_breach || r.is_humidity_breach)
                        ? <span className="text-xs text-danger-500 font-medium">Breach</span>
                        : <span className="text-xs text-success-600">Normal</span>
                      }
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
