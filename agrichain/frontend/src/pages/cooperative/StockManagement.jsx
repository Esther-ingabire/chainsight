import { useState, useEffect } from 'react'
import { Plus, Search, Package, AlertTriangle, CheckCircle, Pencil, Trash2 } from 'lucide-react'
import DataTable from '../../components/ui/DataTable.jsx'
import Modal from '../../components/ui/Modal.jsx'
import { cooperativesApi } from '../../api/cooperatives.js'
import toast from 'react-hot-toast'

const MOCK_STOCK = [
  { id: 1, crop_name: 'Tomatoes', crop: 1, notes: 'Roma variety',    quantity_kg: 1200, quality_grade: 'A', harvest_date: '2026-06-01', available_from: '2026-06-03', is_available: true  },
  { id: 2, crop_name: 'Avocados', crop: 2, notes: 'Hass variety',    quantity_kg: 850,  quality_grade: 'A', harvest_date: '2026-05-28', available_from: '2026-05-30', is_available: true  },
  { id: 3, crop_name: 'Maize',    crop: 3, notes: 'Yellow maize',    quantity_kg: 3400, quality_grade: 'B', harvest_date: '2026-05-20', available_from: '2026-05-25', is_available: false },
  { id: 4, crop_name: 'Beans',    crop: 4, notes: 'Kidney beans',    quantity_kg: 600,  quality_grade: 'A', harvest_date: '2026-06-05', available_from: '2026-06-07', is_available: true  },
  { id: 5, crop_name: 'Potatoes', crop: 5, notes: 'Irish potatoes',  quantity_kg: 2100, quality_grade: 'B', harvest_date: '2026-06-01', available_from: '2026-06-05', is_available: true, low_stock: true },
]

const BLANK_FORM = { crop: '', customCropName: '', quantity_kg: '', quality_grade: 'A', harvest_date: '', available_from: '', notes: '' }

const OTHER_CROP = '__other__'

const GRADE_HELP = {
  A: 'No visible defects or damage, uniform size and colour, ideal ripeness — sells at top price.',
  B: 'Minor blemishes or size variation, still fully usable — sells at standard price.',
  C: 'Visible damage, bruising, or over-ripeness — best moved quickly or sold at a discount.',
}

// Defined outside StockManagement so its identity stays stable across re-renders — defining
// this inline inside the component body would create a brand new function on every keystroke
// (since typing triggers a parent re-render), causing React to remount the <input>/<textarea>
// elements each time and lose focus/cursor position after a single character.
const StockForm = ({ values, onChange, crops, isEdit = false }) => (
  <>
    {!isEdit && (
      <div>
        <label className="label">Crop *</label>
        {crops.length > 0 ? (
          <>
            <select className="input" value={values.crop} onChange={e => onChange('crop', e.target.value)} required>
              <option value="">Select crop…</option>
              {crops.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={OTHER_CROP}>Other…</option>
            </select>
            {values.crop === OTHER_CROP && (
              <input className="input mt-2" value={values.customCropName}
                onChange={e => onChange('customCropName', e.target.value)}
                required placeholder="Type the crop name" autoFocus />
            )}
          </>
        ) : (
          <input className="input" value={values.crop} onChange={e => onChange('crop', e.target.value)} required placeholder="Enter crop name" />
        )}
      </div>
    )}
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="label">Quantity (kg) *</label>
        <input type="number" className="input" value={values.quantity_kg} onChange={e => onChange('quantity_kg', e.target.value)} required min="0.01" step="0.01" />
      </div>
      <div>
        <label className="label">Quality grade *</label>
        <select className="input" value={values.quality_grade} onChange={e => onChange('quality_grade', e.target.value)}>
          <option value="A">Grade A — Premium</option>
          <option value="B">Grade B — Standard</option>
          <option value="C">Grade C — Below standard</option>
        </select>
        <p className="text-xs text-gray-400 mt-1">{GRADE_HELP[values.quality_grade]}</p>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="label">Harvest date *</label>
        <input type="date" className="input" value={values.harvest_date} onChange={e => onChange('harvest_date', e.target.value)} required />
      </div>
      <div>
        <label className="label">Available from *</label>
        <input type="date" className="input" value={values.available_from} onChange={e => onChange('available_from', e.target.value)} required />
      </div>
    </div>
    {isEdit && (
      <div className="flex items-center gap-3">
        <input type="checkbox" id="is_available_edit" checked={values.is_available} onChange={e => onChange('is_available', e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-[#0b2b18]" />
        <label htmlFor="is_available_edit" className="text-sm font-medium text-gray-700">Mark as available for distributor requests</label>
      </div>
    )}
    <div>
      <label className="label">Notes (optional)</label>
      <textarea className="input" rows={2} value={values.notes} onChange={e => onChange('notes', e.target.value)} placeholder="e.g. Roma variety, harvested from sector 3" />
    </div>
  </>
)

export default function StockManagement() {
  const [stock, setStock] = useState(MOCK_STOCK)
  const [crops, setCrops] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)

  const [editingItem, setEditingItem] = useState(null)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({ ...BLANK_FORM, is_available: true })

  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => {
    Promise.all([
      cooperativesApi.getMyStock(),
      cooperativesApi.getCrops(),
    ]).then(([stockRes, cropsRes]) => {
      const s = stockRes.data?.results ?? stockRes.data ?? []
      if (s.length) setStock(s)
      setCrops(cropsRes.data?.results ?? cropsRes.data ?? [])
    }).catch(() => {})
  }, [])

  const filtered = stock.filter(s =>
    (s.crop_name || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalKg = stock.reduce((acc, s) => acc + Number(s.quantity_kg), 0)
  const available = stock.filter(s => s.is_available && !s.low_stock).length
  const lowStock = stock.filter(s => s.low_stock).length

  const handleAdd = async (e) => {
    e.preventDefault()
    const isOther = form.crop === OTHER_CROP
    setSaving(true)
    try {
      const { customCropName, crop, ...rest } = form
      const res = await cooperativesApi.addStock({
        ...rest,
        quantity_kg: Number(form.quantity_kg),
        ...(isOther ? { crop_name: customCropName.trim() } : { crop: Number(crop) }),
      })
      setStock(prev => [res.data, ...prev])
      toast.success('Stock record added')
      setShowAdd(false)
      setForm(BLANK_FORM)
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : 'Could not add stock record'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (item) => {
    setEditingItem(item)
    setEditForm({
      crop: String(item.crop ?? ''),
      quantity_kg: String(item.quantity_kg ?? ''),
      quality_grade: item.quality_grade ?? 'A',
      harvest_date: item.harvest_date ?? '',
      available_from: item.available_from ?? '',
      notes: item.notes ?? '',
      is_available: item.is_available ?? true,
    })
    setShowEdit(true)
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await cooperativesApi.updateStock(editingItem.id, {
        quantity_kg: Number(editForm.quantity_kg),
        quality_grade: editForm.quality_grade,
        harvest_date: editForm.harvest_date,
        available_from: editForm.available_from,
        notes: editForm.notes,
        is_available: editForm.is_available,
      })
      setStock(prev => prev.map(s => s.id === editingItem.id ? res.data : s))
      toast.success('Stock record updated')
      setShowEdit(false)
      setEditingItem(null)
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : 'Could not update stock record'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeletingId(deleteTarget.id)
    try {
      await cooperativesApi.deleteStock(deleteTarget.id)
      setStock(prev => prev.filter(s => s.id !== deleteTarget.id))
      toast.success('Stock record deleted')
    } catch {
      toast.error('Could not delete stock record')
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  const columns = [
    { key: 'crop_name', label: 'Crop', render: (v, row) => (
      <div>
        <p className="font-medium text-gray-900">{v}</p>
        <p className="text-xs text-gray-400">{row.notes || '—'}</p>
      </div>
    )},
    { key: 'quantity_kg', label: 'Quantity (kg)', render: v => <span className="font-medium">{Number(v).toLocaleString()} kg</span> },
    { key: 'quality_grade', label: 'Grade', render: v => (
      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${v === 'A' ? 'bg-success-50 text-success-600' : v === 'B' ? 'bg-warning-50 text-warning-600' : 'bg-gray-100 text-gray-500'}`}>
        Grade {v}
      </span>
    )},
    { key: 'harvest_date', label: 'Harvested', render: v => <span className="text-sm text-gray-600">{v || '—'}</span> },
    { key: 'available_from', label: 'Available from', render: v => <span className="text-sm text-gray-600">{v || '—'}</span> },
    { key: 'is_available', label: 'Status', render: (v, row) => {
      if (row.low_stock) return <span className="text-xs font-medium text-danger-500">low stock</span>
      if (!v) return <span className="text-xs font-medium text-warning-500">reserved</span>
      return <span className="text-xs font-medium text-success-600">available</span>
    }},
    { key: '_actions', label: '', render: (_, row) => (
      <div className="flex items-center gap-3">
        <button
          onClick={e => { e.stopPropagation(); startEdit(row) }}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
        <button
          onClick={e => { e.stopPropagation(); setDeleteTarget(row) }}
          disabled={deletingId === row.id}
          className="flex items-center gap-1 text-xs text-danger-500 hover:text-danger-700 font-medium disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" /> {deletingId === row.id ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    )},
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track and manage your produce inventory.</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Stock
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center border-2 border-primary-500">
          <Package className="w-6 h-6 text-primary-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-gray-900">{loading ? '…' : `${totalKg.toLocaleString()} kg`}</p>
          <p className="text-sm text-gray-500">Total inventory</p>
        </div>
        <div className="card text-center border-2 border-success-500">
          <CheckCircle className="w-6 h-6 text-success-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-gray-900">{loading ? '…' : available}</p>
          <p className="text-sm text-gray-500">Available batches</p>
        </div>
        <div className="card text-center border-2 border-warning-500">
          <AlertTriangle className="w-6 h-6 text-warning-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-gray-900">{loading ? '…' : lowStock}</p>
          <p className="text-sm text-gray-500">Low stock alerts</p>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 py-1.5 text-sm" placeholder="Search crop…" />
          </div>
        </div>
        <DataTable columns={columns} data={filtered} emptyMessage="No stock records yet. Add your first stock entry above." />
      </div>

      {/* Add modal */}
      <Modal isOpen={showAdd} onClose={() => { setShowAdd(false); setForm(BLANK_FORM) }} title="Add Stock Record">
        <form onSubmit={handleAdd} className="space-y-4">
          <StockForm values={form} onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))} crops={crops} />
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowAdd(false); setForm(BLANK_FORM) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
              {saving ? 'Saving…' : 'Add Stock'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={showEdit} onClose={() => { setShowEdit(false); setEditingItem(null) }} title={`Edit — ${editingItem?.crop_name || 'Stock Record'}`}>
        <form onSubmit={handleEdit} className="space-y-4">
          <StockForm values={editForm} onChange={(k, v) => setEditForm(f => ({ ...f, [k]: v }))} crops={crops} isEdit />
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowEdit(false); setEditingItem(null) }} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Stock Record">
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Delete this <strong>{deleteTarget.crop_name}</strong> record
              ({Number(deleteTarget.quantity_kg).toLocaleString()} kg, Grade {deleteTarget.quality_grade})?
              This can't be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button type="button" onClick={confirmDelete} disabled={deletingId === deleteTarget.id}
                className="btn-danger flex-1 disabled:opacity-60 flex items-center justify-center gap-2">
                {deletingId === deleteTarget.id && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {deletingId === deleteTarget.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
