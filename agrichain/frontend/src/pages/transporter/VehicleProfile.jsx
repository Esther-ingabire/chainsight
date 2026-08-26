import { useState, useEffect } from 'react'
import { Box, Save, Plus, Thermometer, Truck, AlertCircle } from 'lucide-react'
import DistrictPicker from '../../components/ui/DistrictPicker.jsx'
import { transportApi } from '../../api/transport.js'
import toast from 'react-hot-toast'

const VEHICLE_TYPE_LABELS = {
  REFRIGERATED:   'Refrigerated Truck',
  STANDARD_TRUCK: 'Standard Truck',
  PICKUP:         'Pickup Truck',
  MOTORCYCLE:     'Motorcycle',
  MINIBUS:        'Minibus',
}

const TYPE_BADGE = {
  REFRIGERATED:   { bg: 'bg-blue-50',   text: 'text-blue-700',   label: 'Refrigerated' },
  STANDARD_TRUCK: { bg: 'bg-gray-100',  text: 'text-gray-700',   label: 'Standard Truck' },
  PICKUP:         { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Pickup' },
  MOTORCYCLE:     { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Motorcycle' },
  MINIBUS:        { bg: 'bg-purple-50', text: 'text-purple-700', label: 'Minibus' },
}

// ── Single vehicle card ───────────────────────────────────────────────────────
function VehicleCard({ vehicle, onSaved }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const editing = form !== null

  const startEdit = () => setForm({
    vehicle_type:        vehicle.vehicle_type,
    plate_number:        vehicle.plate_number,
    capacity_kg:         String(vehicle.capacity_kg),
    operating_districts: Array.isArray(vehicle.operating_districts)
      ? vehicle.operating_districts
      : (vehicle.operating_districts || '').split(',').map(s => s.trim()).filter(Boolean),
    has_iot_temperature: vehicle.has_iot_temperature ?? false,
  })

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      vehicle_type:        form.vehicle_type,
      plate_number:        form.plate_number,
      capacity_kg:         Number(form.capacity_kg),
      operating_districts: form.operating_districts,
      has_iot_temperature: form.has_iot_temperature,
    }
    try {
      const res = await transportApi.updateVehicle(vehicle.id, payload)
      onSaved(res.data)
      toast.success('Vehicle updated')
      setForm(null)
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : 'Could not update vehicle'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const typeBadge = TYPE_BADGE[vehicle.vehicle_type] || { bg: 'bg-gray-100', text: 'text-gray-700', label: vehicle.vehicle_type }
  const districts = Array.isArray(vehicle.operating_districts)
    ? vehicle.operating_districts.join(', ')
    : vehicle.operating_districts || '—'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-2xl">
      {!editing ? (
        <>
          {/* Header row with type + busy badges */}
          <div className="flex items-center gap-2 mb-5">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${typeBadge.bg} ${typeBadge.text}`}>
              {vehicle.vehicle_type === 'REFRIGERATED'
                ? <Thermometer className="w-3.5 h-3.5" />
                : <Truck className="w-3.5 h-3.5" />}
              {typeBadge.label}
            </span>
            {vehicle.has_iot_temperature && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-info-50 text-info-600 border border-info-200">
                IoT Sensor
              </span>
            )}
            {vehicle.is_busy && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-warning-50 text-warning-700 border border-warning-200">
                <AlertCircle className="w-3 h-3" /> On Active Trip
              </span>
            )}
            {!vehicle.is_busy && vehicle.is_active && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-50 text-success-700 border border-success-200">
                Available
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <ReadField label="Registration plate" value={vehicle.plate_number} />
            <ReadField label="Capacity"           value={`${Number(vehicle.capacity_kg || 0).toLocaleString()} kg`} />
            <ReadField label="Operating districts" value={districts} />
            <ReadField label="Status"              value={vehicle.is_active ? 'Active' : 'Inactive'}
              highlight={vehicle.is_active ? 'success' : 'gray'} />
          </div>

          <button onClick={startEdit} className="btn-primary flex items-center gap-2 mt-6">
            <Save className="w-4 h-4" /> Edit Details
          </button>
        </>
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="label">Vehicle type</label>
              <select className="input" value={form.vehicle_type}
                onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}>
                {Object.entries(VEHICLE_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Capacity (kg)</label>
              <input type="number" className="input" value={form.capacity_kg} min="0.01" step="0.01" required
                onChange={e => setForm(f => ({ ...f, capacity_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label">Registration plate</label>
              <input className="input" value={form.plate_number} required placeholder="e.g. RAD 123A"
                onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))} />
            </div>
            <div>
              <label className="label">IoT temperature sensor</label>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-primary-600"
                  checked={form.has_iot_temperature}
                  onChange={e => setForm(f => ({ ...f, has_iot_temperature: e.target.checked }))} />
                <span className="text-sm text-gray-700">This truck has a cold-chain sensor</span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Operating districts</label>
              <DistrictPicker value={form.operating_districts}
                onChange={val => setForm(f => ({ ...f, operating_districts: val }))} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Register new vehicle form ─────────────────────────────────────────────────
function NewVehicleForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({
    vehicle_type: 'STANDARD_TRUCK', plate_number: '', capacity_kg: '',
    operating_districts: [], has_iot_temperature: false,
  })
  const [saving, setSaving] = useState(false)

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      capacity_kg: Number(form.capacity_kg),
    }
    try {
      const res = await transportApi.createVehicle(payload)
      onCreated(res.data)
      toast.success('Vehicle registered successfully')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not register vehicle')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-primary-100 shadow-sm p-6 max-w-2xl">
      <h3 className="font-semibold text-gray-900 mb-5">Register New Vehicle</h3>
      <form onSubmit={handleCreate} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="label">Vehicle type</label>
            <select className="input" value={form.vehicle_type}
              onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}>
              {Object.entries(VEHICLE_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Capacity (kg)</label>
            <input type="number" className="input" value={form.capacity_kg} min="1" required
              placeholder="e.g. 1500"
              onChange={e => setForm(f => ({ ...f, capacity_kg: e.target.value }))} />
          </div>
          <div>
            <label className="label">Registration plate *</label>
            <input className="input" value={form.plate_number} required placeholder="e.g. RAD 123A"
              onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))} />
          </div>
          <div>
            <label className="label">IoT temperature sensor</label>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-primary-600"
                checked={form.has_iot_temperature}
                onChange={e => setForm(f => ({ ...f, has_iot_temperature: e.target.checked }))} />
              <span className="text-sm text-gray-700">Refrigerated with cold-chain sensor</span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Operating districts</label>
            <DistrictPicker value={form.operating_districts}
              onChange={val => setForm(f => ({ ...f, operating_districts: val }))} />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Registering…' : 'Register Vehicle'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function VehicleProfile() {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showNew, setShowNew]   = useState(false)

  useEffect(() => {
    transportApi.getMyVehicles({ _silent: true })
      .then(res => setVehicles(res.data?.results ?? res.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const updateVehicle = (updated) =>
    setVehicles(prev => prev.map(v => v.id === updated.id ? updated : v))

  const addVehicle = (v) => {
    setVehicles(prev => [v, ...prev])
    setShowNew(false)
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-6 px-6 py-3 -mt-6 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicle Profile</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {vehicles.length > 1 ? `${vehicles.length} vehicles registered.` : 'Your registered vehicle.'}
          </p>
        </div>
        <button onClick={() => setShowNew(v => !v)} className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus className="w-4 h-4" /> Register Vehicle
        </button>
      </div>

      {showNew && (
        <NewVehicleForm onCreated={addVehicle} onCancel={() => setShowNew(false)} />
      )}

      {vehicles.length === 0 && !showNew ? (
        <div className="card py-16 text-center">
          <Box className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No vehicles registered yet</p>
          <p className="text-gray-400 text-sm mt-1">Click "Register Vehicle" above to add your first truck.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {vehicles.map(v => (
            <VehicleCard key={v.id} vehicle={v} onSaved={updateVehicle} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReadField({ label, value, highlight }) {
  const cls = highlight === 'success' ? 'text-success-700' : highlight === 'gray' ? 'text-gray-400' : 'text-gray-900'
  return (
    <div>
      <label className="text-xs text-gray-500 font-medium block mb-1">{label}</label>
      <div className="input bg-gray-50 cursor-default text-sm font-medium select-all">
        <span className={cls}>{value || '—'}</span>
      </div>
    </div>
  )
}
