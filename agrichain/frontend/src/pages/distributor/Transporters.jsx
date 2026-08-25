import { useState, useEffect, useCallback } from 'react'
import { Plus, Users, Truck, CheckCircle, Circle, Thermometer, AlertTriangle, Search, MapPin, Clock, Pencil, Ban, RotateCcw } from 'lucide-react'
import Modal from '../../components/ui/Modal.jsx'
import DataTable from '../../components/ui/DataTable.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import DistrictPicker from '../../components/ui/DistrictPicker.jsx'
import LocationSelect from '../../components/ui/LocationSelect.jsx'
import { distributionApi } from '../../api/distribution.js'
import { transportApi } from '../../api/transport.js'
import toast from 'react-hot-toast'

const BLANK = { first_name: '', last_name: '', phone_number: '', email: '', operating_districts: '' }
const BLANK_EDIT = { first_name: '', last_name: '', phone_number: '', email: '', base_location: '', operating_districts: [] }

const VEHICLE_BLANK = { vehicle_type: 'PICKUP', plate_number: '', capacity_kg: '', operating_districts: '' }

const VEHICLE_TYPE_LABELS = {
  REFRIGERATED:   'Refrigerated Truck',
  STANDARD_TRUCK: 'Standard Truck',
  PICKUP:         'Pickup Truck',
  MOTORCYCLE:     'Motorcycle',
  MINIBUS:        'Minibus',
}

const BLANK_REQUEST = {
  transporter: '', vehicle: '', cargo_description: '', estimated_cargo_weight_kg: '',
  pickup_location: '', destination: '', required_pickup_datetime: '',
  requires_refrigeration: false, notes: '',
}

const BUSY_STATUSES = new Set(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'IN_TRANSIT'])

export default function Transporters() {
  const [tab, setTab] = useState('requests')
  const [transporters, setTransporters] = useState([])
  const [monitoring, setMonitoring] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingRequests, setLoadingRequests] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  const [vehicleTarget, setVehicleTarget] = useState(null)
  const [vehicleForm, setVehicleForm] = useState(VEHICLE_BLANK)
  const [savingVehicle, setSavingVehicle] = useState(false)

  const [editingDriver, setEditingDriver] = useState(null)
  const [editForm, setEditForm] = useState(BLANK_EDIT)
  const [savingEdit, setSavingEdit] = useState(false)
  const [suspendingId, setSuspendingId] = useState(null)

  const [showNewRequest, setShowNewRequest] = useState(false)
  const [requestForm, setRequestForm] = useState(BLANK_REQUEST)
  const [savingRequest, setSavingRequest] = useState(false)
  const [transporterSearch, setTransporterSearch] = useState('')
  const [transporterSource, setTransporterSource] = useState('own') // 'own' | 'directory'
  const [directoryTransporters, setDirectoryTransporters] = useState([])
  const [loadingDirectory, setLoadingDirectory] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    distributionApi.getMyFleet({ _silent: true })
      .then(res => setTransporters(res.data || []))
      .catch(() => setTransporters([]))
      .finally(() => setLoading(false))
    distributionApi.getFleetMonitoring({ _silent: true })
      .then(res => setMonitoring(res.data || []))
      .catch(() => setMonitoring([]))

    setLoadingRequests(true)
    transportApi.getMyRequests(undefined, { _silent: true })
      .then(res => setRequests(res.data?.results ?? res.data ?? []))
      .catch(() => setRequests([]))
      .finally(() => setLoadingRequests(false))

    setLoadingDirectory(true)
    transportApi.searchTransporters()
      .then(res => setDirectoryTransporters(res.data?.results ?? res.data ?? []))
      .catch(() => setDirectoryTransporters([]))
      .finally(() => setLoadingDirectory(false))
  }, [])

  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await distributionApi.registerOwnDriver(form)
      const otp = res.data?.otp_code
      toast.success(otp ? `Driver registered! Share this OTP with them to activate: ${otp}` : 'Driver registered.', { duration: 12000 })
      setShowForm(false)
      setForm(BLANK)
      load()
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not register driver')
    } finally {
      setSaving(false)
    }
  }

  const openVehicleForm = (transporter) => {
    setVehicleTarget(transporter)
    setVehicleForm(VEHICLE_BLANK)
  }

  const submitVehicle = async (e) => {
    e.preventDefault()
    setSavingVehicle(true)
    try {
      await transportApi.createVehicle({
        transporter: vehicleTarget.id,
        vehicle_type: vehicleForm.vehicle_type,
        plate_number: vehicleForm.plate_number,
        capacity_kg: Number(vehicleForm.capacity_kg),
        operating_districts: vehicleForm.operating_districts
          ? vehicleForm.operating_districts.split(',').map(s => s.trim()).filter(Boolean)
          : (vehicleTarget.operating_districts || []),
      })
      toast.success(`Vehicle added for ${vehicleTarget.name}`)
      setVehicleTarget(null)
      load()
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not add vehicle')
    } finally {
      setSavingVehicle(false)
    }
  }

  const tName = (t) => t.name || `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'Transporter'
  const tDistricts = (t) => Array.isArray(t.operating_districts) ? t.operating_districts.join(', ') : (t.operating_districts || '')

  const startEditDriver = (t) => {
    const [first_name, ...rest] = tName(t).split(' ')
    setEditingDriver(t)
    setEditForm({
      first_name: first_name || '', last_name: rest.join(' ') || '',
      phone_number: t.phone_number || '', email: t.email || '',
      base_location: t.base_location || '',
      operating_districts: Array.isArray(t.operating_districts) ? t.operating_districts : [],
    })
  }

  const saveEditDriver = async (e) => {
    e.preventDefault()
    setSavingEdit(true)
    try {
      const res = await distributionApi.updateTransporter(editingDriver.id, editForm)
      setTransporters(prev => prev.map(t => t.id === editingDriver.id ? { ...t, ...res.data } : t))
      toast.success('Driver updated')
      setEditingDriver(null)
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not update driver')
    } finally {
      setSavingEdit(false)
    }
  }

  const toggleSuspendDriver = async (t) => {
    setSuspendingId(t.id)
    try {
      if (t.is_active === false) {
        const res = await distributionApi.updateTransporter(t.id, { is_active: true })
        setTransporters(prev => prev.map(x => x.id === t.id ? { ...x, ...res.data } : x))
        toast.success('Driver reactivated')
      } else {
        await distributionApi.deactivateTransporter(t.id)
        setTransporters(prev => prev.map(x => x.id === t.id ? { ...x, is_active: false } : x))
        toast.success('Driver suspended')
      }
    } catch {
      toast.error('Could not update driver status')
    } finally {
      setSuspendingId(null)
    }
  }
  const activeCountFor = (t) => requests.filter(r => {
    if (!BUSY_STATUSES.has(r.status)) return false
    return String(r.transporter) === String(t.id) || r.transporter_name === tName(t)
  }).length

  // How many times this distributor has actually sent a request to a given independent
  // transporter before — surfaced so "who I usually work with" doesn't require re-searching
  // the whole directory every time.
  const workedWithCountFor = (t) => requests.filter(r =>
    String(r.transporter) === String(t.id) || r.transporter_name === tName(t)
  ).length

  const submitRequest = async (e) => {
    e.preventDefault()
    if (!requestForm.transporter) { toast.error('Select a transporter'); return }
    setSavingRequest(true)
    try {
      const res = await transportApi.createRequest({
        ...requestForm,
        estimated_cargo_weight_kg: Number(requestForm.estimated_cargo_weight_kg),
        transporter: Number(requestForm.transporter),
        vehicle: requestForm.vehicle ? Number(requestForm.vehicle) : undefined,
        leg_number: 2,
      })
      setRequests(prev => [res.data, ...prev])
      toast.success('Transport request submitted')
      setShowNewRequest(false)
      setRequestForm(BLANK_REQUEST)
      setTransporterSearch('')
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not submit request')
    } finally {
      setSavingRequest(false)
    }
  }

  const activeCount = transporters.filter(t => t.has_active_trip).length
  const pendingRequests = requests.filter(r => r.status === 'PENDING').length

  const requestColumns = [
    { key: 'id', label: 'Request ID', render: v => <span className="font-mono text-sm">#{v}</span> },
    { key: 'destination', label: 'Route', render: (v, row) => (
      <div>
        <p className="font-medium text-sm text-gray-900">{row.pickup_location} → {v}</p>
        <p className="text-xs text-gray-500">{row.cargo_description}</p>
      </div>
    )},
    { key: 'estimated_cargo_weight_kg', label: 'Weight', render: v => v ? `${Number(v).toLocaleString()} kg` : '—' },
    { key: 'required_pickup_datetime', label: 'Pickup', render: v => v ? new Date(v).toLocaleDateString('en-RW', { month: 'short', day: 'numeric' }) : '—' },
    { key: 'transporter_name', label: 'Transporter', render: v => v || <span className="text-gray-400 text-sm">—</span> },
    { key: 'status', label: 'Status', render: v => <StatusBadge status={v} /> },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transporters</h1>
          <p className="text-sm text-gray-500 mt-0.5">Request transport and manage the drivers who run your own vehicles.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(true)} className="btn-secondary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Register Driver
          </button>
          <button onClick={() => setShowNewRequest(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Request
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card flex items-center gap-4">
          <Truck className="w-6 h-6 text-primary-500" />
          <div><p className="text-xl font-bold">{loadingRequests ? '…' : requests.length}</p><p className="text-sm text-gray-500">Total requests</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <Clock className="w-6 h-6 text-warning-500" />
          <div><p className="text-xl font-bold">{loadingRequests ? '…' : pendingRequests}</p><p className="text-sm text-gray-500">Pending</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <Users className="w-6 h-6 text-success-500" />
          <div><p className="text-xl font-bold">{loading ? '…' : transporters.length}</p><p className="text-sm text-gray-500">My drivers</p></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[{ id: 'requests', label: 'Requests' }, { id: 'drivers', label: 'My Drivers' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Requests tab */}
      {tab === 'requests' && (
        <div className="card p-0 overflow-hidden">
          {loadingRequests
            ? <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            : <DataTable columns={requestColumns} data={requests} emptyMessage="No transport requests yet." />
          }
        </div>
      )}

      {/* My Drivers tab */}
      {tab === 'drivers' && (
        <>
          {loading ? (
            <div className="space-y-3">{[1, 2].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-50" />)}</div>
          ) : transporters.length === 0 ? (
            <div className="card py-16 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No drivers registered yet.</p>
              <p className="text-sm mt-1">If you own your own vehicles, register a driver so they can run deliveries for you.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transporters.map(t => {
                const vehicleCount = t.vehicles?.length || 0
                const suspended = t.is_active === false
                return (
                  <div key={t.id} className={`card flex items-center gap-5 ${suspended ? 'opacity-60' : ''}`}>
                    <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <Truck className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{t.name}</p>
                      <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap mt-0.5">
                        <span>{t.phone_number}</span>
                        {t.operating_districts?.length > 0 && <span>{t.operating_districts.join(', ')}</span>}
                        <span>{vehicleCount} vehicle{vehicleCount === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    {!suspended && vehicleCount === 0 && (
                      <button onClick={() => openVehicleForm(t)}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-600 border border-primary-200 hover:bg-primary-50 transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Add Vehicle
                      </button>
                    )}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {suspended ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-danger-50 text-danger-700">
                          Suspended
                        </span>
                      ) : t.has_active_trip ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-success-50 text-success-600">
                          <CheckCircle className="w-3.5 h-3.5" /> On active trip
                        </span>
                      ) : vehicleCount === 0 ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-warning-50 text-warning-600">
                          <Circle className="w-3.5 h-3.5" /> Awaiting vehicle
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                          <Circle className="w-3.5 h-3.5" /> Idle
                        </span>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1.5">
                      <button onClick={() => startEditDriver(t)} title="Edit driver"
                        className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleSuspendDriver(t)} disabled={suspendingId === t.id}
                        title={suspended ? 'Reactivate driver' : 'Suspend driver'}
                        className={`p-2 rounded-lg transition-colors disabled:opacity-60 ${suspended ? 'text-gray-400 hover:text-success-600 hover:bg-success-50' : 'text-gray-400 hover:text-danger-600 hover:bg-danger-50'}`}>
                        {suspended ? <RotateCcw className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {monitoring.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Live vehicle readings</p>
              {monitoring.map(m => (
                <div key={m.trip_id} className={`card flex items-center gap-4 ${m.is_breach ? 'border-l-4 border-l-danger-500' : ''}`}>
                  <Thermometer className={`w-5 h-5 flex-shrink-0 ${m.is_breach ? 'text-danger-600' : 'text-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{m.driver_name} — {m.pickup_location} → {m.destination}</p>
                    {m.open_incidents > 0 && (
                      <p className="text-xs text-warning-600 flex items-center gap-1 mt-0.5"><AlertTriangle className="w-3 h-3" /> {m.open_incidents} open incident{m.open_incidents > 1 ? 's' : ''} reported</p>
                    )}
                  </div>
                  {m.latest_temperature != null ? (
                    <p className={`text-sm font-bold flex-shrink-0 ${m.is_breach ? 'text-danger-600' : 'text-success-600'}`}>{m.latest_temperature}°C</p>
                  ) : (
                    <p className="text-xs text-gray-400 flex-shrink-0">No reading yet</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Register Driver modal */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Register Driver">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First name *</label>
              <input className="input" required value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Last name *</label>
              <input className="input" required value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Phone number *</label>
            <input className="input" required placeholder="+250 7XX XXX XXX" value={form.phone_number}
              onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email (for OTP)</label>
            <input type="email" className="input" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Operating districts</label>
            <DistrictPicker
              value={Array.isArray(form.operating_districts) ? form.operating_districts : (form.operating_districts || '').split(',').map(s => s.trim()).filter(Boolean)}
              onChange={val => setForm(f => ({ ...f, operating_districts: val }))}
            />
          </div>
          <p className="text-xs text-gray-500">
            They get their own login. They'll receive an OTP to activate their account.
          </p>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Registering…' : 'Register Driver'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Driver modal */}
      <Modal isOpen={!!editingDriver} onClose={() => setEditingDriver(null)} title={editingDriver ? `Edit — ${tName(editingDriver)}` : 'Edit Driver'}>
        {editingDriver && (
          <form onSubmit={saveEditDriver} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">First name *</label>
                <input className="input" required value={editForm.first_name}
                  onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Last name *</label>
                <input className="input" required value={editForm.last_name}
                  onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Phone number *</label>
              <input className="input" required value={editForm.phone_number}
                onChange={e => setEditForm(f => ({ ...f, phone_number: e.target.value }))} />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="label">Base location</label>
              <LocationSelect value={editForm.base_location} onChange={val => setEditForm(f => ({ ...f, base_location: val }))} placeholder="Select base district…" />
            </div>
            <div>
              <label className="label">Operating districts</label>
              <DistrictPicker value={editForm.operating_districts} onChange={val => setEditForm(f => ({ ...f, operating_districts: val }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditingDriver(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={savingEdit} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {savingEdit && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Vehicle modal */}
      <Modal isOpen={!!vehicleTarget} onClose={() => setVehicleTarget(null)} title={vehicleTarget ? `Add Vehicle for ${vehicleTarget.name}` : 'Add Vehicle'}>
        {vehicleTarget && (
          <form onSubmit={submitVehicle} className="space-y-4">
            <p className="text-sm text-gray-500">
              They haven't added a vehicle yet — you can register one on their behalf so they can start accepting jobs right away.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Vehicle type *</label>
                <select className="input" value={vehicleForm.vehicle_type}
                  onChange={e => setVehicleForm(f => ({ ...f, vehicle_type: e.target.value }))}>
                  {Object.entries(VEHICLE_TYPE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Plate number *</label>
                <input className="input" required placeholder="e.g. RAD 123 A" value={vehicleForm.plate_number}
                  onChange={e => setVehicleForm(f => ({ ...f, plate_number: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Capacity (kg) *</label>
              <input type="number" className="input" required min="0.01" step="0.01" value={vehicleForm.capacity_kg}
                onChange={e => setVehicleForm(f => ({ ...f, capacity_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label">Operating districts</label>
              <DistrictPicker
                value={vehicleForm.operating_districts ? vehicleForm.operating_districts.split(',').map(s => s.trim()).filter(Boolean) : (vehicleTarget.operating_districts || [])}
                onChange={val => setVehicleForm(f => ({ ...f, operating_districts: val.join(', ') }))}
              />
              <p className="text-xs text-gray-400 mt-1">Defaults to {vehicleTarget.name}'s own districts if left unchanged.</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setVehicleTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={savingVehicle} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {savingVehicle && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {savingVehicle ? 'Adding…' : 'Add Vehicle'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* New Transport Request modal */}
      <Modal isOpen={showNewRequest} onClose={() => { setShowNewRequest(false); setTransporterSearch('') }} title="New Transport Request">
        <form onSubmit={submitRequest} className="space-y-4">
          <div>
            <label className="label">Select transporter *</label>

            <div className="flex gap-1 mb-2 bg-gray-100 rounded-lg p-0.5 w-fit">
              {[
                { id: 'own', label: `My Drivers (${transporters.filter(t => t.is_active !== false).length})` },
                { id: 'directory', label: `Independent (${directoryTransporters.length})` },
              ].map(opt => (
                <button key={opt.id} type="button" onClick={() => setTransporterSource(opt.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    transporterSource === opt.id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="input pl-8 text-sm"
                placeholder="Filter by name or district…"
                value={transporterSearch}
                onChange={e => setTransporterSearch(e.target.value)}
              />
            </div>

            {transporterSource === 'own' ? (
              transporters.length === 0 ? (
                <p className="text-xs text-warning-500">No drivers registered yet. <button type="button" onClick={() => { setShowNewRequest(false); setShowForm(true) }} className="underline">Register one first.</button></p>
              ) : (
                <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {transporters
                    .filter(t => t.is_active !== false)
                    .filter(t => {
                      if (!transporterSearch.trim()) return true
                      const q = transporterSearch.toLowerCase()
                      return tName(t).toLowerCase().includes(q) || tDistricts(t).toLowerCase().includes(q)
                    })
                    .map(t => {
                      const selected = String(requestForm.transporter) === String(t.id)
                      const activeCnt = activeCountFor(t)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setRequestForm(f => ({ ...f, transporter: t.id, vehicle: t.vehicles?.[0]?.id || '' }))}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${selected ? 'bg-primary-100' : 'bg-gray-100'}`}>
                            <Truck className={`w-4 h-4 ${selected ? 'text-primary-600' : 'text-gray-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${selected ? 'text-primary-700' : 'text-gray-900'}`}>{tName(t)}</p>
                            <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              {tDistricts(t) || 'No districts listed'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {activeCnt > 0
                              ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-50 text-warning-600">{activeCnt} active</span>
                              : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-success-50 text-success-600">Free</span>
                            }
                            {selected && <span className="text-primary-600 text-xs font-medium">Selected</span>}
                          </div>
                        </button>
                      )
                    })}
                </div>
              )
            ) : null}

            {/* Vehicle picker — only relevant for own drivers, once one is selected */}
            {transporterSource === 'own' && requestForm.transporter && (() => {
              const selectedDriver = transporters.find(t => String(t.id) === String(requestForm.transporter))
              const vehicles = selectedDriver?.vehicles || []
              if (vehicles.length === 0) {
                return (
                  <p className="text-xs text-warning-600 mt-2">
                    {tName(selectedDriver || {})} has no vehicle registered yet — this request will be sent without one assigned.
                  </p>
                )
              }
              return (
                <div className="mt-3">
                  <label className="label">Vehicle</label>
                  <select className="input text-sm" value={requestForm.vehicle}
                    onChange={e => setRequestForm(f => ({ ...f, vehicle: e.target.value }))}>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.plate_number} — {VEHICLE_TYPE_LABELS[v.vehicle_type] || v.vehicle_type}</option>
                    ))}
                  </select>
                </div>
              )
            })()}

            {transporterSource === 'directory' ? (
              loadingDirectory ? (
                <div className="py-6 text-center text-gray-400 text-sm">Loading independent transporters…</div>
              ) : directoryTransporters.length === 0 ? (
                <p className="text-xs text-gray-400">No independent transport companies available right now.</p>
              ) : (
                <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {directoryTransporters
                    .filter(t => {
                      if (!transporterSearch.trim()) return true
                      const q = transporterSearch.toLowerCase()
                      return tName(t).toLowerCase().includes(q) || tDistricts(t).toLowerCase().includes(q)
                    })
                    .map(t => ({ t, workedWith: workedWithCountFor(t) }))
                    .sort((a, b) => b.workedWith - a.workedWith)
                    .map(({ t, workedWith }) => {
                      const selected = String(requestForm.transporter) === String(t.id)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setRequestForm(f => ({ ...f, transporter: t.id }))}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${selected ? 'bg-primary-100' : 'bg-gray-100'}`}>
                            <Truck className={`w-4 h-4 ${selected ? 'text-primary-600' : 'text-gray-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={`text-sm font-medium truncate ${selected ? 'text-primary-700' : 'text-gray-900'}`}>{tName(t)}</p>
                              {workedWith > 0 && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 border border-primary-200 flex-shrink-0">
                                  Worked with before
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              {tDistricts(t) || 'No districts listed'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {t.average_rating != null ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-50 text-warning-600">★ {t.average_rating} ({t.rating_count})</span>
                            ) : (
                              <span className="text-xs text-gray-400">Not yet rated</span>
                            )}
                            {selected && <span className="text-primary-600 text-xs font-medium">Selected</span>}
                          </div>
                        </button>
                      )
                    })}
                </div>
              )
            ) : null}
          </div>
          <div>
            <label className="label">Pickup location *</label>
            <input className="input" required placeholder="e.g. Kigali Warehouse A" value={requestForm.pickup_location}
              onChange={e => setRequestForm(f => ({ ...f, pickup_location: e.target.value }))} />
          </div>
          <div>
            <label className="label">Destination *</label>
            <input className="input" required placeholder="e.g. Kimironko Market" value={requestForm.destination}
              onChange={e => setRequestForm(f => ({ ...f, destination: e.target.value }))} />
          </div>
          <div>
            <label className="label">Cargo description *</label>
            <input className="input" required placeholder="e.g. Tomatoes – 200 kg" value={requestForm.cargo_description}
              onChange={e => setRequestForm(f => ({ ...f, cargo_description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Estimated weight (kg) *</label>
              <input type="number" className="input" required min="0.01" step="0.01" value={requestForm.estimated_cargo_weight_kg}
                onChange={e => setRequestForm(f => ({ ...f, estimated_cargo_weight_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label">Required pickup date/time *</label>
              <input type="datetime-local" className="input" required value={requestForm.required_pickup_datetime}
                onChange={e => setRequestForm(f => ({ ...f, required_pickup_datetime: e.target.value }))}
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="refrig-dist" checked={requestForm.requires_refrigeration}
              onChange={e => setRequestForm(f => ({ ...f, requires_refrigeration: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300" />
            <label htmlFor="refrig-dist" className="text-sm font-medium text-gray-700">Requires refrigeration (cold chain)</label>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input" rows={2} value={requestForm.notes}
              onChange={e => setRequestForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowNewRequest(false); setTransporterSearch('') }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={savingRequest} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {savingRequest && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {savingRequest ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
