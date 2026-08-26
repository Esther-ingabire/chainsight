import { useState, useEffect } from 'react'
import { Clock, MapPin, Route, UserPlus } from 'lucide-react'
import DeclineReasonPicker from '../../components/ui/DeclineReasonPicker.jsx'
import { transportApi } from '../../api/transport.js'
import { useAuth } from '../../context/AuthContext.jsx'
import toast from 'react-hot-toast'

const MOCK_REQUESTS = [
  { id: 1, requester_type: 'Cooperative', requester_name: 'Musanze Farmers Coop',     pickup_location: 'Musanze',   destination: 'Kigali',              cargo_description: 'Coffee',   estimated_cargo_weight_kg: '1250', required_pickup_datetime: '2026-05-05T09:00:00Z', requires_refrigeration: false },
  { id: 2, requester_type: 'Distributor', requester_name: 'Kigali Fresh Distributors', pickup_location: 'Kigali',    destination: 'Nyanza',              cargo_description: 'Maize',    estimated_cargo_weight_kg: '800',  required_pickup_datetime: '2026-05-06T08:00:00Z', requires_refrigeration: false },
  { id: 3, requester_type: 'Cooperative', requester_name: 'Rubavu Farmers Coop',       pickup_location: 'Rubavu',    destination: 'Kigali',              cargo_description: 'Potatoes', estimated_cargo_weight_kg: '1500', required_pickup_datetime: '2026-05-07T07:00:00Z', requires_refrigeration: false },
  { id: 4, requester_type: 'Cooperative', requester_name: 'Bugesera Agri Coop',        pickup_location: 'Bugesera',  destination: 'Nyabugogo Market',    cargo_description: 'Rice',     estimated_cargo_weight_kg: '1000', required_pickup_datetime: '2026-05-08T09:00:00Z', requires_refrigeration: false },
  { id: 5, requester_type: 'Cooperative', requester_name: 'Rwamagana Farmers',         pickup_location: 'Rwamagana', destination: 'Kimironko Market',    cargo_description: 'Beans',    estimated_cargo_weight_kg: '600',  required_pickup_datetime: '2026-05-09T06:00:00Z', requires_refrigeration: false },
  { id: 6, requester_type: 'Cooperative', requester_name: 'Nyamasheke Coop',           pickup_location: 'Nyamasheke',destination: 'Kigali',              cargo_description: 'Tea',      estimated_cargo_weight_kg: '1800', required_pickup_datetime: '2026-05-10T08:00:00Z', requires_refrigeration: false },
]

// vehicles = full company fleet (all trucks, regardless of which driver registered them)
// drivers  = all company drivers
// Driver and truck are independent choices — any available driver + any available truck.
function AssignDriverPanel({ req, drivers, vehicles, onAssign, assigning }) {
  const [driverId, setDriverId] = useState('')
  const [vehicleId, setVehicleId] = useState('')

  const freeVehicles = vehicles.filter(v => v.is_active && !v.is_busy)
  const busyVehicles = vehicles.filter(v => v.is_active &&  v.is_busy)
  const reqId = Array.isArray(req) ? req[0]?.id : req.id

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2.5">

      {/* Driver picker — greyed out if currently on a trip */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Select driver</p>
        <select className="input text-sm" value={driverId} onChange={e => setDriverId(e.target.value)}>
          <option value="">— Choose a driver —</option>
          {drivers.filter(d => d.is_active !== false).map(d => (
            <option key={d.id} value={d.id} disabled={d.has_active_trip}>
              {d.name}{d.has_active_trip ? ' · currently on a trip' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Vehicle picker — full company fleet, busy trucks shown but disabled */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Select truck from company fleet</p>
        {vehicles.length === 0 ? (
          <p className="text-xs text-warning-600 bg-warning-50 rounded-lg px-3 py-2">
            No vehicles registered in the company fleet yet. Add trucks in Fleet Management.
          </p>
        ) : (
          <select className="input text-sm" value={vehicleId} onChange={e => setVehicleId(e.target.value)} required>
            <option value="">— Choose a truck —</option>
            {freeVehicles.map(v => (
              <option key={v.id} value={v.id}>
                {v.plate_number} · {v.vehicle_type.replace(/_/g, ' ')} · {Number(v.capacity_kg || 0).toLocaleString()} kg
              </option>
            ))}
            {busyVehicles.length > 0 && (
              <optgroup label="On active trip — unavailable">
                {busyVehicles.map(v => (
                  <option key={v.id} value={v.id} disabled>
                    {v.plate_number} · {v.vehicle_type.replace(/_/g, ' ')} · on active trip
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
      </div>

      <button
        onClick={() => onAssign(req, driverId, vehicleId)}
        disabled={!driverId || !vehicleId || !!assigning}
        className="w-full py-2.5 rounded-xl bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 text-white text-sm font-semibold transition-colors disabled:opacity-50">
        {assigning === reqId ? 'Assigning…' : 'Confirm Assignment'}
      </button>
    </div>
  )
}

const TRANSPORT_DECLINE_REASONS = [
  'Not available on this date',
  'Route not covered',
  'Vehicle at capacity',
  'Insufficient notice',
]

function RequestCard({ req, onAction, acting, compact = false, isCompany = false, drivers = [], vehicles = [], onAssign, assigning }) {
  const [showAssign, setShowAssign] = useState(false)
  const [showDecline, setShowDecline] = useState(false)
  const pickupDate = req.required_pickup_datetime
    ? new Date(req.required_pickup_datetime).toLocaleDateString('en-RW', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'
  const weightKg = Number(req.estimated_cargo_weight_kg || 0)

  return (
    <div className={compact ? 'border border-gray-100 rounded-xl p-3.5 space-y-2.5' : 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3'}>
      <div className="flex items-center gap-2">
        {req.stop_sequence && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Stop {req.stop_sequence}</span>
        )}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${req.requester_type === 'Cooperative' ? 'bg-success-50 text-success-700' : 'bg-primary-50 text-primary-700'}`}>
          {req.requester_type}
        </span>
        <span className="text-xs text-gray-400 font-mono">REQ-TR-{String(req.id).padStart(3, '0')}</span>
      </div>

      <div>
        <p className={compact ? 'text-sm font-bold text-gray-900' : 'text-base font-bold text-gray-900'}>{req.pickup_location} → {req.destination}</p>
        <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          {req.cargo_description} · {weightKg.toLocaleString()} kg · Pickup: {pickupDate}
        </p>
        {req.requester_name && (
          <p className="text-xs text-gray-400 mt-0.5">From {req.requester_name}</p>
        )}
      </div>

      {showDecline ? (
        <DeclineReasonPicker
          quickReasons={TRANSPORT_DECLINE_REASONS}
          busy={acting === `${req.id}-decline`}
          onConfirm={reason => { setShowDecline(false); onAction(req, 'decline', reason) }}
          onCancel={() => setShowDecline(false)}
        />
      ) : isCompany && drivers.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={() => setShowAssign(v => !v)} disabled={!!acting}
            className="py-2.5 rounded-xl bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            <UserPlus className="w-4 h-4" /> Approve & Assign
          </button>
          <button onClick={() => setShowDecline(true)} disabled={!!acting}
            className="py-2.5 rounded-xl border border-danger-400/60 text-danger-600 bg-white/40 hover:bg-danger-50/80 backdrop-blur-sm text-sm font-semibold transition-colors disabled:opacity-60">
            Decline
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={() => onAction(req, 'accept')} disabled={!!acting}
            className="py-2.5 rounded-xl bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 text-white text-sm font-semibold transition-colors disabled:opacity-60">
            {acting === `${req.id}-accept` ? 'Accepting…' : 'Accept'}
          </button>
          <button onClick={() => setShowDecline(true)} disabled={!!acting}
            className="py-2.5 rounded-xl border border-danger-400/60 text-danger-600 bg-white/40 hover:bg-danger-50/80 backdrop-blur-sm text-sm font-semibold transition-colors disabled:opacity-60">
            Decline
          </button>
        </div>
      )}

      {isCompany && showAssign && !showDecline && drivers.length > 0 && (
        <AssignDriverPanel req={req} drivers={drivers} vehicles={vehicles} onAssign={onAssign} assigning={assigning} />
      )}
    </div>
  )
}

function MultiStopGroup({ stops, onAction, onBulkAction, acting, bulkActing, isCompany = false, drivers = [], vehicles = [], onBulkAssign, assigning }) {
  const sorted = [...stops].sort((a, b) => (a.stop_sequence || 0) - (b.stop_sequence || 0))
  const totalWeight = sorted.reduce((sum, s) => sum + Number(s.estimated_cargo_weight_kg || 0), 0)
  const [showAssign, setShowAssign] = useState(false)

  return (
    <div className="bg-white rounded-2xl border-2 border-primary-100 shadow-sm p-5 space-y-3 lg:col-span-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-primary-600" />
          <p className="text-base font-bold text-gray-900">Multi-stop run — {sorted.length} stops, one truck</p>
        </div>
        <span className="text-xs text-gray-400">{totalWeight.toLocaleString()} kg total · from {sorted[0].pickup_location}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map(req => (
          <RequestCard key={req.id} req={req} onAction={onAction} acting={acting} compact />
        ))}
      </div>
      {isCompany && drivers.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100 pt-3">
          <button
            onClick={() => setShowAssign(v => !v)}
            disabled={!!bulkActing || !!acting}
            className="py-2.5 rounded-xl bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 text-white text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            <UserPlus className="w-4 h-4" /> Approve & Assign Run
          </button>
          <button
            onClick={() => onBulkAction(sorted, 'decline')}
            disabled={!!bulkActing || !!acting}
            className="py-2.5 rounded-xl border border-danger-400/60 text-danger-600 bg-white/40 hover:bg-danger-50/80 backdrop-blur-sm text-sm font-semibold transition-colors disabled:opacity-60">
            {bulkActing === 'decline' ? 'Declining all…' : 'Decline All'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100 pt-3">
          <button
            onClick={() => onBulkAction(sorted, 'accept')}
            disabled={!!bulkActing || !!acting}
            className="py-2.5 rounded-xl bg-primary-500/80 hover:bg-primary-500 border border-primary-400/40 backdrop-blur-sm shadow-md shadow-primary-900/15 text-white text-sm font-semibold transition-colors disabled:opacity-60">
            {bulkActing === 'accept' ? 'Accepting all…' : `Accept All ${sorted.length} Stops`}
          </button>
          <button
            onClick={() => onBulkAction(sorted, 'decline')}
            disabled={!!bulkActing || !!acting}
            className="py-2.5 rounded-xl border border-danger-400/60 text-danger-600 bg-white/40 hover:bg-danger-50/80 backdrop-blur-sm text-sm font-semibold transition-colors disabled:opacity-60">
            {bulkActing === 'decline' ? 'Declining all…' : 'Decline All'}
          </button>
        </div>
      )}

      {isCompany && showAssign && drivers.length > 0 && (
        <AssignDriverPanel req={sorted} drivers={drivers} vehicles={vehicles} onAssign={onBulkAssign} assigning={assigning} />
      )}
    </div>
  )
}

export default function PendingRequests() {
  const { user } = useAuth()
  const isCompany = user?.role === 'TRANSPORT_COMPANY'
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState(null)
  const [bulkActing, setBulkActing] = useState(null)
  const [drivers, setDrivers]   = useState([])
  const [vehicles, setVehicles] = useState([])   // full company fleet
  const [assigning, setAssigning] = useState(null)

  useEffect(() => {
    transportApi.getMyRequests({ status: 'PENDING' }, { _silent: true })
      .then(res => setRequests(res.data?.results ?? res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!isCompany) return
    // Load both drivers and the full company vehicle fleet in parallel
    Promise.all([
      transportApi.getMyDrivers({ _silent: true }),
      transportApi.getMyVehicles({ _silent: true }),
    ]).then(([dRes, vRes]) => {
      setDrivers(dRes.data?.results ?? dRes.data ?? [])
      setVehicles(vRes.data?.results ?? vRes.data ?? [])
    }).catch(() => {})
  }, [isCompany])

  const handleAction = async (req, action, reason = '') => {
    setActing(`${req.id}-${action}`)
    try {
      if (action === 'accept') {
        await transportApi.acceptRequest(req.id)
        toast.success('Request accepted')
      } else {
        await transportApi.declineRequest(req.id, { reason: reason || 'Declined' })
        toast.success('Request declined')
      }
      setRequests(prev => prev.filter(r => r.id !== req.id))
    } catch (err) {
      toast.error(err.response?.data?.detail || `Failed to ${action} request`)
    } finally {
      setActing(null)
    }
  }

  const handleAssign = async (req, driverId, vehicleId) => {
    setAssigning(req.id)
    try {
      await transportApi.assignDriver(req.id, { driver: driverId, vehicle: vehicleId || undefined })
      toast.success('Job assigned to driver')
      setRequests(prev => prev.filter(r => r.id !== req.id))
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not assign driver')
    } finally {
      setAssigning(null)
    }
  }

  const handleBulkAssign = async (stops, driverId, vehicleId) => {
    setAssigning('bulk')
    try {
      await Promise.all(stops.map(req => transportApi.assignDriver(req.id, { driver: driverId, vehicle: vehicleId || undefined })))
      toast.success(`${stops.length} stops assigned to driver`)
      const ids = new Set(stops.map(s => s.id))
      setRequests(prev => prev.filter(r => !ids.has(r.id)))
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not assign driver')
    } finally {
      setAssigning(null)
    }
  }

  const handleBulkAction = async (stops, action) => {
    setBulkActing(action)
    const results = await Promise.allSettled(stops.map(req =>
      action === 'accept' ? transportApi.acceptRequest(req.id) : transportApi.declineRequest(req.id, { reason: 'Not available' })
    ))
    const succeeded = stops.filter((_, i) => results[i].status === 'fulfilled')
    const failedCount = stops.length - succeeded.length
    if (succeeded.length > 0) {
      const ids = new Set(succeeded.map(s => s.id))
      setRequests(prev => prev.filter(r => !ids.has(r.id)))
    }
    const verb = action === 'accept' ? 'accepted' : 'declined'
    if (failedCount === 0) {
      toast.success(`${stops.length} stops ${verb}`)
    } else if (succeeded.length === 0) {
      toast.error(`Failed to ${action} ${failedCount} stop${failedCount > 1 ? 's' : ''}`)
    } else {
      toast.error(`${succeeded.length} stops ${verb}, ${failedCount} failed`)
    }
    setBulkActing(null)
  }

  // Group requests sharing a run_id into one multi-stop run; everything else stays standalone.
  const runs = {}
  const standalone = []
  requests.forEach(req => {
    if (req.run_id) {
      runs[req.run_id] = runs[req.run_id] || []
      runs[req.run_id].push(req)
    } else {
      standalone.push(req)
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pending Requests</h1>
        <p className="text-sm text-gray-500 mt-0.5">Transport requests awaiting your response.</p>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading requests…</div>
      ) : requests.length === 0 ? (
        <div className="card py-16 text-center">
          <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No pending requests</p>
          <p className="text-gray-400 text-sm mt-1">New transport requests will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(runs).map(([runId, stops]) => (
            <MultiStopGroup key={runId} stops={stops} onAction={handleAction} onBulkAction={handleBulkAction} acting={acting} bulkActing={bulkActing}
              isCompany={isCompany} drivers={drivers} vehicles={vehicles} onBulkAssign={handleBulkAssign} assigning={assigning} />
          ))}
          {standalone.map(req => (
            <RequestCard key={req.id} req={req} onAction={handleAction} acting={acting}
              isCompany={isCompany} drivers={drivers} vehicles={vehicles} onAssign={handleAssign} assigning={assigning} />
          ))}
        </div>
      )}
    </div>
  )
}
