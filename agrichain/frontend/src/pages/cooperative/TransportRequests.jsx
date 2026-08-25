import { useState, useEffect } from 'react'
import { Truck, Plus, CheckCircle, Clock, MapPin, Users, UserPlus, X, Phone, Snowflake, Pencil, UserX, RotateCcw, Search, Route, Star } from 'lucide-react'
import Modal from '../../components/ui/Modal.jsx'
import DistrictPicker from '../../components/ui/DistrictPicker.jsx'
import LocationSelect from '../../components/ui/LocationSelect.jsx'
import StatusBadge from '../../components/ui/StatusBadge.jsx'
import DataTable from '../../components/ui/DataTable.jsx'
import PlaceSearchInput from '../../components/map/PlaceSearchInput.jsx'
import { transportApi } from '../../api/transport.js'
import { cooperativesApi } from '../../api/cooperatives.js'
import toast from 'react-hot-toast'


const MOCK_REQUESTS = [
  { id: 'TR-001', cargo_description: 'Tomatoes', estimated_cargo_weight_kg: 450, pickup_location: 'Musanze', destination: 'Kigali Central Market', required_pickup_datetime: '2026-06-12T07:00:00Z', requires_refrigeration: true,  status: 'IN_TRANSIT', transporter_name: 'Claude Mugisha' },
  { id: 'TR-002', cargo_description: 'Avocados', estimated_cargo_weight_kg: 300, pickup_location: 'Huye',    destination: 'Kigali',                 required_pickup_datetime: '2026-06-13T08:00:00Z', requires_refrigeration: false, status: 'PENDING',    transporter_name: 'Marie Uwase' },
  { id: 'TR-003', cargo_description: 'Beans',    estimated_cargo_weight_kg: 600, pickup_location: 'Musanze', destination: 'Huye Market',            required_pickup_datetime: '2026-06-11T06:00:00Z', requires_refrigeration: false, status: 'COMPLETED',  transporter_name: 'Jean Habimana' },
]

const MOCK_TRANSPORTERS = [
  { id: 1, first_name: 'Claude',  last_name: 'Mugisha',   phone_number: '+250781234567', operating_districts: 'Musanze, Kigali' },
  { id: 2, first_name: 'Marie',   last_name: 'Uwase',     phone_number: '+250782345678', operating_districts: 'Huye, Kigali' },
  { id: 3, first_name: 'Jean',    last_name: 'Habimana',  phone_number: '+250783456789', operating_districts: 'Rwamagana, Huye' },
]

const BLANK_REQUEST = {
  transporter: '',
  cargo_description: '',
  estimated_cargo_weight_kg: '',
  pickup_location: '',
  destination: '',
  required_pickup_datetime: '',
  requires_refrigeration: false,
  notes: '',
}

const BLANK_TRANSPORTER = {
  first_name: '', last_name: '', phone_number: '', email: '',
  operating_districts: '',
}

const BLANK_VEHICLE = { vehicle_type: 'PICKUP', plate_number: '', capacity_kg: '', operating_districts: '' }

const VEHICLE_TYPE_LABELS = {
  REFRIGERATED:   'Refrigerated Truck',
  STANDARD_TRUCK: 'Standard Truck',
  PICKUP:         'Pickup Truck',
  MOTORCYCLE:     'Motorcycle',
  MINIBUS:        'Minibus',
}

export default function TransportRequests() {
  const [tab, setTab] = useState('requests')
  const [requests, setRequests] = useState([])
  const [transporters, setTransporters] = useState([])
  const [loadingRequests, setLoadingRequests] = useState(true)
  const [loadingTransporters, setLoadingTransporters] = useState(true)

  const [showNewRequest, setShowNewRequest] = useState(false)
  const [transporterSearch, setTransporterSearch] = useState('')
  const [showRegister, setShowRegister] = useState(false)
  const [showEditTransporter, setShowEditTransporter] = useState(false)
  const [editingTransporter, setEditingTransporter] = useState(null)
  const [editTForm, setEditTForm] = useState({ first_name: '', last_name: '', phone_number: '', email: '', base_location: '', operating_districts: [] })
  const [suspendingId, setSuspendingId] = useState(null)
  const [form, setForm] = useState(BLANK_REQUEST)
  const [vehicleTarget, setVehicleTarget] = useState(null)
  const [vehicleForm, setVehicleForm] = useState(BLANK_VEHICLE)
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [ratingTarget, setRatingTarget] = useState(null)
  const [ratingValue, setRatingValue] = useState(0)
  const [ratingHover, setRatingHover] = useState(0)
  const [ratingComment, setRatingComment] = useState('')
  const [submittingRating, setSubmittingRating] = useState(false)
  const [tForm, setTForm] = useState(BLANK_TRANSPORTER)
  const [saving, setSaving] = useState(false)
  const [transporterSource, setTransporterSource] = useState('own') // 'own' | 'directory'
  const [directoryTransporters, setDirectoryTransporters] = useState([])
  const [loadingDirectory, setLoadingDirectory] = useState(false)
  // Extra drop-offs beyond `form.destination` — a multi-stop run, one pickup → several
  // destinations for the same transporter (e.g. different crops to different distributors).
  const [extraStops, setExtraStops] = useState([])

  const addStop = () => setExtraStops(prev => [...prev, { destination: '', cargo_description: '', estimated_cargo_weight_kg: '', notes: '' }])
  const updateStop = (i, field, value) => setExtraStops(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  const removeStop = (i) => setExtraStops(prev => prev.filter((_, idx) => idx !== i))

  useEffect(() => {
    transportApi.getMyRequests(undefined, { _silent: true })
      .then(res => {
        const data = res.data?.results ?? res.data ?? []
        setRequests(data.length ? data : MOCK_REQUESTS)
      })
      .catch(() => setRequests(MOCK_REQUESTS))
      .finally(() => setLoadingRequests(false))

    cooperativesApi.getMyTransporters({ _silent: true })
      .then(res => {
        const data = res.data?.results ?? res.data ?? []
        setTransporters(data.length ? data : MOCK_TRANSPORTERS)
      })
      .catch(() => setTransporters(MOCK_TRANSPORTERS))
      .finally(() => setLoadingTransporters(false))

    setLoadingDirectory(true)
    transportApi.searchTransporters()
      .then(res => setDirectoryTransporters(res.data?.results ?? res.data ?? []))
      .catch(() => setDirectoryTransporters([]))
      .finally(() => setLoadingDirectory(false))
  }, [])

  const submitRequest = async (e) => {
    e.preventDefault()
    if (!form.transporter) { toast.error('Select a transporter'); return }
    setSaving(true)
    try {
      if (extraStops.length > 0) {
        const res = await transportApi.createMultiStopRequest({
          transporter: Number(form.transporter),
          leg_number: 1,
          pickup_location: form.pickup_location,
          requires_refrigeration: form.requires_refrigeration,
          required_pickup_datetime: form.required_pickup_datetime,
          stops: [
            { destination: form.destination, cargo_description: form.cargo_description, estimated_cargo_weight_kg: Number(form.estimated_cargo_weight_kg), notes: form.notes },
            ...extraStops.map(s => ({ ...s, estimated_cargo_weight_kg: Number(s.estimated_cargo_weight_kg) })),
          ],
        })
        setRequests(prev => [...res.data, ...prev])
        toast.success(`Multi-stop request submitted — ${res.data.length} stops`)
      } else {
        const res = await transportApi.createRequest({
          ...form,
          estimated_cargo_weight_kg: Number(form.estimated_cargo_weight_kg),
          transporter: Number(form.transporter),
          leg_number: 1,
        })
        setRequests(prev => [res.data, ...prev])
        toast.success('Transport request submitted')
      }
      setShowNewRequest(false)
      setForm(BLANK_REQUEST)
      setExtraStops([])
      setTransporterSearch('')
    } catch {
      // interceptor handles toast
    } finally {
      setSaving(false)
    }
  }

  const submitRegister = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await cooperativesApi.registerOwnDriver(tForm)
      const otp = res.data?.otp_code
      if (otp) {
        toast.success(`Driver registered! Share this OTP with them to activate: ${otp}`, { duration: 12000 })
      } else {
        toast.success('Driver registered — OTP sent to activate their account')
      }
      // Refresh transporters list
      const tRes = await cooperativesApi.getMyTransporters()
      setTransporters(tRes.data?.results ?? tRes.data ?? [])
      setShowRegister(false)
      setTForm(BLANK_TRANSPORTER)
    } catch (err) {
      const data = err.response?.data
      const msg = data
        ? Object.values(data).flat().join(' ')
        : 'Failed to register driver'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const openVehicleForm = (transporter) => {
    setVehicleTarget(transporter)
    setVehicleForm(BLANK_VEHICLE)
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
          : (Array.isArray(vehicleTarget.operating_districts) ? vehicleTarget.operating_districts : []),
      })
      toast.success(`Vehicle added for ${tName(vehicleTarget)}`)
      setVehicleTarget(null)
      const tRes = await cooperativesApi.getMyTransporters()
      setTransporters(tRes.data?.results ?? tRes.data ?? [])
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not add vehicle')
    } finally {
      setSavingVehicle(false)
    }
  }

  const tName = (t) => t.name || `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'Transporter'
  const tDistricts = (t) => Array.isArray(t.operating_districts)
    ? t.operating_districts.join(', ')
    : t.operating_districts || ''

  const BUSY_STATUSES = new Set(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'IN_TRANSIT'])
  const activeCountFor = (t) => requests.filter(r => {
    if (!BUSY_STATUSES.has(r.status)) return false
    return String(r.transporter) === String(t.id) || r.transporter_name === tName(t)
  }).length

  // How many times this cooperative has actually sent a request to a given independent
  // transporter before — surfaced so "who I usually work with" doesn't require re-searching
  // the whole directory every time.
  const workedWithCountFor = (t) => requests.filter(r =>
    String(r.transporter) === String(t.id) || r.transporter_name === tName(t)
  ).length

  const startEditTransporter = (t) => {
    const [first_name, ...rest] = tName(t).split(' ')
    setEditingTransporter(t)
    setEditTForm({
      first_name: first_name || '', last_name: rest.join(' ') || '',
      phone_number: t.phone_number || '', email: t.email || '',
      base_location: t.base_location || '',
      operating_districts: Array.isArray(t.operating_districts) ? t.operating_districts : [],
    })
    setShowEditTransporter(true)
  }

  const handleEditTransporter = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await cooperativesApi.updateTransporter(editingTransporter.id, editTForm)
      setTransporters(prev => prev.map(t => t.id === editingTransporter.id ? { ...t, ...res.data } : t))
      toast.success('Driver updated')
      setShowEditTransporter(false)
      setEditingTransporter(null)
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not update driver')
    } finally {
      setSaving(false)
    }
  }

  const toggleSuspendTransporter = async (t) => {
    setSuspendingId(t.id)
    try {
      if (t.is_active === false) {
        const res = await cooperativesApi.updateTransporter(t.id, { is_active: true })
        setTransporters(prev => prev.map(x => x.id === t.id ? { ...x, ...res.data } : x))
        toast.success('Driver reactivated')
      } else {
        await cooperativesApi.deactivateTransporter(t.id)
        setTransporters(prev => prev.map(x => x.id === t.id ? { ...x, is_active: false } : x))
        toast.success('Driver suspended')
      }
    } catch {
      toast.error('Could not update driver status')
    } finally {
      setSuspendingId(null)
    }
  }

  const openRating = (req) => {
    setRatingTarget(req)
    setRatingValue(0)
    setRatingComment('')
  }

  const submitRating = async (e) => {
    e.preventDefault()
    if (!ratingValue) { toast.error('Pick a star rating first'); return }
    setSubmittingRating(true)
    try {
      await transportApi.rateRequest(ratingTarget.id, { rating: ratingValue, comment: ratingComment })
      toast.success('Thanks — rating submitted')
      setRequests(prev => prev.map(r => r.id === ratingTarget.id ? { ...r, has_rating: true } : r))
      setRatingTarget(null)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Could not submit rating')
    } finally {
      setSubmittingRating(false)
    }
  }


  const requestColumns = [
    { key: 'id', label: 'ID', render: v => <span className="font-mono text-sm">#{v}</span> },
    { key: 'cargo_description', label: 'Cargo / Weight', render: (v, row) => (
      <div>
        <p className="font-medium">{v || '—'}</p>
        <p className="text-xs text-gray-500 flex items-center gap-1">{Number(row.estimated_cargo_weight_kg || 0).toLocaleString()} kg {row.requires_refrigeration && <span className="inline-flex items-center gap-0.5 text-info-600"><Snowflake className="w-3 h-3" />Cold chain</span>}</p>
      </div>
    )},
    { key: 'pickup_location', label: 'Route', render: (v, row) => (
      <span className="flex items-center gap-1 text-sm"><MapPin className="w-3 h-3 text-gray-400" />{v} → {row.destination}</span>
    )},
    { key: 'required_pickup_datetime', label: 'Pickup', render: v => v ? v.split('T')[0] : '—' },
    { key: 'transporter_name', label: 'Transporter', render: v => v || <span className="text-gray-400 text-sm">—</span> },
    { key: 'status', label: 'Status', render: (v, row) => (
      <div className="space-y-1">
        <StatusBadge status={v} />
        {v === 'DECLINED' && row.decline_reason && (
          <p className="text-xs text-danger-600 bg-danger-50 rounded px-2 py-1 max-w-[180px]">
            {row.decline_reason}
          </p>
        )}
      </div>
    )},
    { key: 'rate_action', label: '', render: (_, row) => row.status === 'COMPLETED' && (
      row.has_rating
        ? <span className="text-xs text-gray-400 flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-warning-400 text-warning-400" /> Rated</span>
        : <button onClick={() => openRating(row)} className="text-xs font-semibold text-primary-600 hover:underline">Rate</button>
    )},
  ]

  const pending = requests.filter(r => r.status === 'PENDING').length
  const completed = requests.filter(r => r.status === 'COMPLETED').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transport</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your transporters and transport requests.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowRegister(true)} className="btn-secondary flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Register Driver
          </button>
          <button onClick={() => setShowNewRequest(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Request
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total requests', value: loadingRequests ? '…' : requests.length, icon: <Truck className="w-5 h-5 text-primary-500" /> },
          { label: 'Pending', value: loadingRequests ? '…' : pending, icon: <Clock className="w-5 h-5 text-warning-500" /> },
          { label: 'My transporters', value: loadingTransporters ? '…' : transporters.length, icon: <Users className="w-5 h-5 text-success-500" /> },
        ].map(s => (
          <div key={s.label} className="card flex items-center gap-4">
            {s.icon}
            <div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[{ id: 'requests', label: 'Requests' }, { id: 'transporters', label: 'My Transporters' }].map(t => (
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

      {/* My Transporters tab */}
      {tab === 'transporters' && (
        <div className="card p-0 overflow-hidden">
          {loadingTransporters ? (
            <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
          ) : transporters.length === 0 ? (
            <div className="py-16 text-center">
              <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No drivers registered yet</p>
              <p className="text-gray-400 text-sm mt-1">If your cooperative owns its own trucks, register a driver so they can run deliveries for you.</p>
              <button onClick={() => setShowRegister(true)} className="btn-primary mt-4 inline-flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Register Driver
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {transporters.map(t => {
                const vehicleCount = t.vehicles?.length || 0
                return (
                <div key={t.id} className={`flex items-center justify-between px-5 py-4 hover:bg-gray-50 ${t.is_active === false ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
                      <Truck className="w-5 h-5 text-primary-500" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{tName(t)}</p>
                      {tDistricts(t) && (
                        <p className="text-xs text-gray-400">{tDistricts(t)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{vehicleCount} vehicle{vehicleCount !== 1 ? 's' : ''}</span>
                    {t.is_active !== false && vehicleCount === 0 && (
                      <button onClick={() => openVehicleForm(t)}
                        className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium px-2 py-1 rounded border border-primary-200 hover:bg-primary-50">
                        <Plus className="w-3 h-3" /> Add Vehicle
                      </button>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${t.is_active !== false ? 'bg-success-50 text-success-500' : 'bg-danger-50 text-danger-700'}`}>
                      {t.is_active !== false ? 'Active' : 'Suspended'}
                    </span>
                    <button onClick={() => startEditTransporter(t)}
                      className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium px-2 py-1 rounded hover:bg-primary-50">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => toggleSuspendTransporter(t)} disabled={suspendingId === t.id}
                      className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded disabled:opacity-60 ${
                        t.is_active === false
                          ? 'text-success-600 hover:text-success-800 hover:bg-success-50'
                          : 'text-danger-500 hover:text-danger-700 hover:bg-danger-50'
                      }`}>
                      {t.is_active === false
                        ? <><RotateCcw className="w-3 h-3" /> Reactivate</>
                        : <><UserX className="w-3 h-3" /> Suspend</>}
                    </button>
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* New Transport Request modal */}
      <Modal isOpen={showNewRequest} onClose={() => { setShowNewRequest(false); setTransporterSearch(''); setExtraStops([]) }} title="New Transport Request">
        <form onSubmit={submitRequest} className="space-y-4">
          <div>
            <label className="label">Select transporter *</label>

            {/* Own drivers vs. independent transport companies to hire */}
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
                <p className="text-xs text-warning-500">No drivers registered yet. <button type="button" onClick={() => { setShowNewRequest(false); setShowRegister(true) }} className="underline">Register one first.</button></p>
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
                      const selected = String(form.transporter) === String(t.id)
                      const activeCount = activeCountFor(t)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, transporter: t.id }))}
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
                            {activeCount > 0
                              ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-50 text-warning-600">{activeCount} active</span>
                              : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-success-50 text-success-600">Free</span>
                            }
                            {selected && <span className="text-primary-600 text-xs font-medium">Selected</span>}
                          </div>
                        </button>
                      )
                    })}
                  {transporters.filter(t => {
                    if (!transporterSearch.trim()) return true
                    const q = transporterSearch.toLowerCase()
                    return tName(t).toLowerCase().includes(q) || tDistricts(t).toLowerCase().includes(q)
                  }).length === 0 && (
                    <p className="text-center text-sm text-gray-400 py-4">No drivers match "{transporterSearch}"</p>
                  )}
                </div>
              )
            ) : (
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
                      const selected = String(form.transporter) === String(t.id)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, transporter: t.id }))}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${selected ? 'bg-primary-100' : 'bg-gray-100'}`}>
                            <Truck className={`w-4 h-4 ${selected ? 'text-primary-600' : 'text-gray-400'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={`text-sm font-medium truncate ${selected ? 'text-primary-700' : 'text-gray-900'}`}>{tName(t)}</p>
                              {workedWith > 0 && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-600 border border-primary-200 flex items-center gap-0.5 flex-shrink-0">
                                  <Star className="w-2.5 h-2.5 fill-primary-500 text-primary-500" /> Worked with before
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
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-50 text-warning-600 flex items-center gap-0.5">
                                <Star className="w-3 h-3 fill-warning-400 text-warning-400" /> {t.average_rating} ({t.rating_count})
                              </span>
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
            )}
          </div>
          <div>
            <label className="label">Cargo description</label>
            <input className="input" value={form.cargo_description} onChange={e => setForm(f => ({ ...f, cargo_description: e.target.value }))} required placeholder="e.g. Tomatoes – 450 kg, Grade A" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Estimated weight (kg)</label>
              <input type="number" className="input" value={form.estimated_cargo_weight_kg} onChange={e => setForm(f => ({ ...f, estimated_cargo_weight_kg: e.target.value }))} required min="0.01" step="0.01" />
            </div>
            <div>
              <label className="label">Required pickup date</label>
              <input type="datetime-local" className="input" value={form.required_pickup_datetime} onChange={e => setForm(f => ({ ...f, required_pickup_datetime: e.target.value }))} required min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Pickup location</label>
              <PlaceSearchInput
                placeholder="Search pickup location…"
                onSelect={({ address, lat, lng }) => setForm(f => ({
                  ...f,
                  pickup_location: address,
                  pickup_gps_lat: lat,
                  pickup_gps_lng: lng,
                }))}
              />
              {form.pickup_location && (
                <p className="text-xs text-primary-600 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {form.pickup_location}
                </p>
              )}
            </div>
            <div>
              <label className="label">Destination{extraStops.length > 0 ? ' — Stop 1' : ''}</label>
              <PlaceSearchInput
                placeholder="Search destination…"
                onSelect={({ address, lat, lng }) => setForm(f => ({
                  ...f,
                  destination: address,
                  destination_gps_lat: lat,
                  destination_gps_lng: lng,
                }))}
              />
              {form.destination && (
                <p className="text-xs text-primary-600 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {form.destination}
                </p>
              )}
            </div>
          </div>

          {/* Additional stops — multi-stop run, same pickup & transporter */}
          {extraStops.map((stop, i) => (
            <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-3 relative">
              <button type="button" onClick={() => removeStop(i)}
                className="absolute top-2 right-2 text-gray-300 hover:text-danger-500">
                <X className="w-4 h-4" />
              </button>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stop {i + 2}</p>
              <input className="input" required placeholder="Destination, e.g. Huye Market"
                value={stop.destination} onChange={e => updateStop(i, 'destination', e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <input className="input" required placeholder="Cargo description"
                  value={stop.cargo_description} onChange={e => updateStop(i, 'cargo_description', e.target.value)} />
                <input type="number" className="input" required min="0.01" step="0.01" placeholder="Weight (kg)"
                  value={stop.estimated_cargo_weight_kg} onChange={e => updateStop(i, 'estimated_cargo_weight_kg', e.target.value)} />
              </div>
            </div>
          ))}
          <button type="button" onClick={addStop}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium text-primary-600 border border-dashed border-primary-300 rounded-xl py-2.5 hover:bg-primary-50 transition-colors">
            <Route className="w-4 h-4" /> Add another stop
          </button>

          <div className="flex items-center gap-3">
            <input type="checkbox" id="refrig" checked={form.requires_refrigeration} onChange={e => setForm(f => ({ ...f, requires_refrigeration: e.target.checked }))} className="w-4 h-4 rounded border-gray-300" />
            <label htmlFor="refrig" className="text-sm font-medium text-gray-700">Requires refrigeration (cold chain)</label>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowNewRequest(false); setExtraStops([]) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
              {saving ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Transporter modal */}
      <Modal isOpen={showEditTransporter} onClose={() => { setShowEditTransporter(false); setEditingTransporter(null) }}
        title={`Edit — ${editingTransporter ? tName(editingTransporter) : ''}`}>
        <form onSubmit={handleEditTransporter} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First name *</label>
              <input className="input" required value={editTForm.first_name}
                onChange={e => setEditTForm(f => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Last name *</label>
              <input className="input" required value={editTForm.last_name}
                onChange={e => setEditTForm(f => ({ ...f, last_name: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Phone number *</label>
            <input className="input" required value={editTForm.phone_number}
              onChange={e => setEditTForm(f => ({ ...f, phone_number: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={editTForm.email}
              onChange={e => setEditTForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Base location</label>
            <LocationSelect value={editTForm.base_location} onChange={val => setEditTForm(f => ({ ...f, base_location: val }))} placeholder="Select base district…" />
          </div>
          <div>
            <label className="label">Operating districts</label>
            <DistrictPicker value={editTForm.operating_districts} onChange={val => setEditTForm(f => ({ ...f, operating_districts: val }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowEditTransporter(false); setEditingTransporter(null) }}
              className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Register Driver modal */}
      <Modal isOpen={showRegister} onClose={() => setShowRegister(false)} title="Register Driver">
        <form onSubmit={submitRegister} className="space-y-4">
          <p className="text-sm text-gray-500">If your cooperative owns its own trucks, register a driver to run deliveries for you. They'll get their own login and an OTP to activate their account — you can assign them a vehicle right after.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First name *</label>
              <input className="input" value={tForm.first_name} onChange={e => setTForm(f => ({ ...f, first_name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Last name *</label>
              <input className="input" value={tForm.last_name} onChange={e => setTForm(f => ({ ...f, last_name: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="label">Phone number *</label>
            <input className="input" value={tForm.phone_number} onChange={e => setTForm(f => ({ ...f, phone_number: e.target.value }))} required placeholder="+250 7XX XXX XXX" />
          </div>
          <div>
            <label className="label">Email (for OTP)</label>
            <input type="email" className="input" value={tForm.email} onChange={e => setTForm(f => ({ ...f, email: e.target.value }))} placeholder="driver@example.com" />
          </div>
          <div>
            <label className="label">Operating districts</label>
            <input className="input" value={tForm.operating_districts} onChange={e => setTForm(f => ({ ...f, operating_districts: e.target.value }))} placeholder="e.g. Musanze, Kigali" />
            <p className="text-xs text-gray-400 mt-1">Comma-separated list of districts</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowRegister(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Registering…' : 'Register Driver'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!ratingTarget} onClose={() => setRatingTarget(null)} title="Rate This Delivery">
        {ratingTarget && (
          <form onSubmit={submitRating} className="space-y-4">
            <p className="text-sm text-gray-500">
              {ratingTarget.transporter_name} — {ratingTarget.pickup_location} → {ratingTarget.destination}
            </p>
            <div>
              <label className="label">How was the delivery?</label>
              <div className="flex gap-1 mt-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" onClick={() => setRatingValue(n)}
                    onMouseEnter={() => setRatingHover(n)} onMouseLeave={() => setRatingHover(0)}
                    className="p-0.5 transition-transform hover:scale-110">
                    <Star className={`w-7 h-7 transition-colors ${n <= (ratingHover || ratingValue) ? 'fill-warning-400 text-warning-400' : 'text-gray-200'}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Comment (optional)</label>
              <textarea className="input" rows={3} value={ratingComment} onChange={e => setRatingComment(e.target.value)}
                placeholder="On time, careful handling, anything worth noting…" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setRatingTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={submittingRating} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {submittingRating && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {submittingRating ? 'Submitting…' : 'Submit Rating'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Vehicle modal — for a driver who hasn't registered one yet */}
      <Modal isOpen={!!vehicleTarget} onClose={() => setVehicleTarget(null)} title={vehicleTarget ? `Add Vehicle for ${tName(vehicleTarget)}` : 'Add Vehicle'}>
        {vehicleTarget && (
          <form onSubmit={submitVehicle} className="space-y-4">
            <p className="text-sm text-gray-500">
              They haven't added a vehicle yet — register one of the cooperative's trucks on their behalf so they can start accepting jobs right away.
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
                value={vehicleForm.operating_districts ? vehicleForm.operating_districts.split(',').map(s => s.trim()).filter(Boolean) : (Array.isArray(vehicleTarget.operating_districts) ? vehicleTarget.operating_districts : [])}
                onChange={val => setVehicleForm(f => ({ ...f, operating_districts: val.join(', ') }))}
              />
              <p className="text-xs text-gray-400 mt-1">Defaults to {tName(vehicleTarget)}'s own districts if left unchanged.</p>
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
    </div>
  )
}
