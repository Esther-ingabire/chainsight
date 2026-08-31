import { useState, useEffect, useCallback } from 'react'
import { Plus, Warehouse, Thermometer, MapPin, Pencil, ToggleLeft, ToggleRight, List, Map as MapIcon, Trash2, RotateCcw } from 'lucide-react'
import Modal from '../../components/ui/Modal.jsx'
import MapboxMap from '../../components/map/MapboxMap.jsx'
import PlaceSearchInput from '../../components/map/PlaceSearchInput.jsx'
import { warehouseApi } from '../../api/warehouse.js'
import toast from 'react-hot-toast'

const BLANK = {
  name: '', capacity_kg: '', location_description: '', gps_latitude: '', gps_longitude: '',
  has_iot_sensor: false, is_available_for_rent: false, rental_price_per_month: '',
}

export default function MyFacilities() {
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState('list')

  const load = useCallback(() => {
    setLoading(true)
    warehouseApi.getMyFacilities()
      .then(res => setFacilities(res.data?.results ?? res.data ?? []))
      .catch(() => toast.error('Could not load facilities.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditing(null); setForm(BLANK); setShowForm(true) }
  const openEdit = (f) => {
    setEditing(f)
    setForm({
      name: f.name, capacity_kg: f.capacity_kg, location_description: f.location_description || '',
      gps_latitude: f.gps_latitude || '', gps_longitude: f.gps_longitude || '',
      has_iot_sensor: f.has_iot_sensor, is_available_for_rent: f.is_available_for_rent,
      rental_price_per_month: f.rental_price_per_month || '',
    })
    setShowForm(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      capacity_kg: Number(form.capacity_kg),
      gps_latitude: form.gps_latitude || null,
      gps_longitude: form.gps_longitude || null,
      rental_price_per_month: form.rental_price_per_month || null,
    }
    try {
      if (editing) {
        const res = await warehouseApi.updateFacility(editing.id, payload)
        setFacilities(prev => prev.map(f => f.id === editing.id ? res.data : f))
        toast.success('Facility updated')
      } else {
        const res = await warehouseApi.createFacility(payload)
        setFacilities(prev => [res.data, ...prev])
        toast.success('Facility added')
      }
      setShowForm(false)
    } catch (err) {
      const data = err.response?.data
      toast.error(data ? Object.values(data).flat().join(' ') : 'Could not save facility')
    } finally {
      setSaving(false)
    }
  }

  const toggleRentable = async (f) => {
    try {
      const res = await warehouseApi.updateFacility(f.id, { is_available_for_rent: !f.is_available_for_rent })
      setFacilities(prev => prev.map(x => x.id === f.id ? res.data : x))
    } catch (err) {
      toast.error(err.response?.data?.is_available_for_rent?.[0] || 'Could not update listing status')
    }
  }

  const toggleActive = async (f) => {
    const activating = !f.is_active
    if (!activating && !window.confirm(`Deactivate "${f.name}"? It will stop appearing as available and won't be rentable until reactivated.`)) return
    try {
      const res = await warehouseApi.updateFacility(f.id, { is_active: activating })
      setFacilities(prev => prev.map(x => x.id === f.id ? res.data : x))
      toast.success(activating ? 'Facility reactivated' : 'Facility deactivated')
    } catch (err) {
      toast.error(err.response?.data?.is_active?.[0] || 'Could not update facility status')
    }
  }

  const pinLat = form.gps_latitude ? parseFloat(form.gps_latitude) : null
  const pinLng = form.gps_longitude ? parseFloat(form.gps_longitude) : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Facilities</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your cold storage facilities and list space for cooperatives to rent.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-xl overflow-hidden">
            <button onClick={() => setView('list')}
              className={`px-3 py-2 flex items-center gap-1.5 text-sm font-medium transition-colors ${view === 'list' ? 'bg-primary-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              <List className="w-3.5 h-3.5" /> List
            </button>
            <button onClick={() => setView('map')}
              className={`px-3 py-2 flex items-center gap-1.5 text-sm font-medium transition-colors ${view === 'map' ? 'bg-primary-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              <MapIcon className="w-3.5 h-3.5" /> Map
            </button>
          </div>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Facility
          </button>
        </div>
      </div>

      {view === 'map' ? (
        <MapboxMap
          height={420}
          fitToMarkers
          showSearch
          markers={facilities
            .filter(f => f.gps_latitude != null && f.gps_longitude != null)
            .map(f => ({
              id: f.id,
              lat: parseFloat(f.gps_latitude),
              lng: parseFloat(f.gps_longitude),
              color: f.cooperative_name ? '#15803d' : f.is_available_for_rent ? '#228b52' : '#9ca3af',
              onClick: () => openEdit(f),
            }))}
        />
      ) : loading ? (
        <div className="space-y-3">{[1, 2].map(i => <div key={i} className="card h-28 animate-pulse bg-gray-50" />)}</div>
      ) : facilities.length === 0 ? (
        <div className="card py-16 text-center text-gray-400">
          <Warehouse className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No facilities yet.</p>
          <p className="text-sm mt-1">Add a facility so cooperatives can rent space in it.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {facilities.map(f => (
            <div key={f.id} className={`card flex items-center gap-5 ${!f.is_active ? 'opacity-60' : ''}`}>
              <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                <Warehouse className="w-5 h-5 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-gray-900">{f.name}</p>
                  {!f.is_active && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
                  )}
                  {f.cooperative_name && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-success-50 text-success-600">
                      Rented by {f.cooperative_name}
                    </span>
                  )}
                  {!f.cooperative_name && f.is_available_for_rent && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">Listed for rent</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                  <span>{Number(f.capacity_kg).toLocaleString()} kg capacity</span>
                  {f.location_description && (
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{f.location_description}</span>
                  )}
                  {f.has_iot_sensor && (
                    <span className="flex items-center gap-1 text-success-600"><Thermometer className="w-3 h-3" />IoT active</span>
                  )}
                  {f.rental_price_per_month && (
                    <span className="text-gray-700 font-medium">RWF {Number(f.rental_price_per_month).toLocaleString()}/mo</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {!f.cooperative_name && (
                  <button
                    onClick={() => toggleRentable(f)}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-primary-600"
                    title={f.is_available_for_rent ? 'Unlist from rental directory' : 'List for rental'}
                  >
                    {f.is_available_for_rent ? <ToggleRight className="w-5 h-5 text-primary-500" /> : <ToggleLeft className="w-5 h-5" />}
                    {f.is_available_for_rent ? 'Listed' : 'Unlisted'}
                  </button>
                )}
                <button onClick={() => openEdit(f)} className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                  <Pencil className="w-4 h-4" />
                </button>
                {!f.cooperative_name && (
                  <button
                    onClick={() => toggleActive(f)}
                    className={`p-2 rounded-lg ${f.is_active ? 'text-gray-400 hover:text-danger-500 hover:bg-danger-50' : 'text-gray-400 hover:text-success-600 hover:bg-success-50'}`}
                    title={f.is_active ? 'Deactivate facility' : 'Reactivate facility'}
                  >
                    {f.is_active ? <Trash2 className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editing ? `Edit ${editing.name}` : 'Add Facility'}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Facility name *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="e.g. Kigali Cold Hub" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Capacity (kg) *</label>
              <input type="number" className="input" required min="0.01" step="0.01" value={form.capacity_kg}
                onChange={e => setForm(f => ({ ...f, capacity_kg: e.target.value }))} />
            </div>
            <div>
              <label className="label">Rental price (RWF/month)</label>
              <input type="number" className="input" min="0" value={form.rental_price_per_month}
                onChange={e => setForm(f => ({ ...f, rental_price_per_month: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Location description</label>
            <input className="input" value={form.location_description}
              onChange={e => setForm(f => ({ ...f, location_description: e.target.value }))} placeholder="e.g. Kicukiro, Kigali" />
          </div>

          <div>
            <label className="label">Find the address on the map</label>
            <PlaceSearchInput
              placeholder="Search an address in Rwanda…"
              onSelect={({ lat, lng, address }) => setForm(f => ({
                ...f,
                gps_latitude: lat.toFixed(6), gps_longitude: lng.toFixed(6),
                location_description: f.location_description || address,
              }))}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Search picks an approximate point — drag the pin below to fine-tune the exact spot.
            </p>
          </div>

          <MapboxMap
            height={220}
            zoom={pinLat ? 14 : 9}
            center={pinLat ? [pinLat, pinLng] : null}
            fitToMarkers={!!pinLat}
            markers={pinLat ? [{
              id: 'pin', lat: pinLat, lng: pinLng, draggable: true,
              onDragEnd: ({ lat, lng }) => setForm(f => ({ ...f, gps_latitude: lat.toFixed(6), gps_longitude: lng.toFixed(6) })),
            }] : []}
          />
          {pinLat != null && (
            <p className="text-xs text-gray-400 -mt-2">Pin set at {pinLat.toFixed(5)}, {pinLng.toFixed(5)}</p>
          )}

          <div className="flex items-center gap-3">
            <input type="checkbox" id="iot" checked={form.has_iot_sensor}
              onChange={e => setForm(f => ({ ...f, has_iot_sensor: e.target.checked }))} className="w-4 h-4 rounded border-gray-300" />
            <label htmlFor="iot" className="text-sm font-medium text-gray-700">Has an IoT temperature/humidity sensor installed</label>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="rentable" checked={form.is_available_for_rent}
              onChange={e => setForm(f => ({ ...f, is_available_for_rent: e.target.checked }))} className="w-4 h-4 rounded border-gray-300" />
            <label htmlFor="rentable" className="text-sm font-medium text-gray-700">List this facility for cooperatives to rent</label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Facility'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
