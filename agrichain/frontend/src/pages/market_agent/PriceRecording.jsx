import { useState, useEffect, useCallback } from 'react'
import { Plus, TrendingUp, TrendingDown, Loader2, Pencil, Trash2, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { marketAgentApi } from '../../api/marketAgent.js'

const CROPS = ['Tomatoes', 'Avocados', 'Maize', 'Beans', 'Potatoes', 'Onions', 'Carrots', 'Cabbage']
const MARKETS = ['Kigali Central Market', 'Kigali Kimironko', 'Huye Market', 'Musanze Market', 'Rubavu Market']

const BLANK_FORM = { crop_name: '', price_per_kg: '', market_name: 'Kigali Central Market', quality_grade: 'A', notes: '' }

export default function PriceRecording() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    marketAgentApi.getMyPriceRecords()
      .then(res => setRecords(res.data?.results ?? res.data ?? []))
      .catch(() => toast.error('Could not load your price records'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const startEdit = (r) => {
    setEditingId(r.id)
    setForm({
      crop_name: r.crop_name, price_per_kg: String(r.price_per_kg),
      market_name: r.market_name, quality_grade: r.quality_grade, notes: r.notes || '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(BLANK_FORM)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editingId) {
        const res = await marketAgentApi.updatePriceRecord(editingId, {
          crop_name: form.crop_name,
          price_per_kg: Number(form.price_per_kg),
          market_name: form.market_name,
          quality_grade: form.quality_grade,
          notes: form.notes,
        })
        setRecords(rs => rs.map(r => r.id === editingId ? res.data : r))
        toast.success('Price record updated')
        setEditingId(null)
        setForm(BLANK_FORM)
      } else {
        const res = await marketAgentApi.recordPrice({
          crop_name: form.crop_name,
          price_per_kg: Number(form.price_per_kg),
          market_name: form.market_name,
          quality_grade: form.quality_grade,
          notes: form.notes,
        })
        setRecords(r => [res.data, ...r])
        toast.success('Price recorded')
        setForm(f => ({ ...BLANK_FORM, market_name: f.market_name }))
      }
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : 'Could not save price record'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    setDeletingId(id)
    try {
      await marketAgentApi.deletePriceRecord(id)
      setRecords(rs => rs.filter(r => r.id !== id))
      toast.success('Price record deleted')
      if (editingId === id) cancelEdit()
    } catch {
      toast.error('Could not delete price record')
    } finally {
      setDeletingId(null)
    }
  }

  const today = new Date().toDateString()
  const todaysRecords = records.filter(r => new Date(r.recorded_at).toDateString() === today)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Record Market Prices</h1>
        <p className="text-sm text-gray-500 mt-0.5">Submit current prices from your market. Data feeds into the national analytics system.</p>
      </div>

      {/* Form */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-700 mb-4">{editingId ? 'Edit price entry' : 'New price entry'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Crop</label>
              <select className="input" value={form.crop_name} onChange={e => setForm(f => ({ ...f, crop_name: e.target.value }))} required>
                <option value="">Select crop…</option>
                {CROPS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Price (RWF/kg)</label>
              <input type="number" className="input" value={form.price_per_kg} onChange={e => setForm(f => ({ ...f, price_per_kg: e.target.value }))} required min="0.01" step="0.01" placeholder="e.g. 850" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Market</label>
              <select className="input" value={form.market_name} onChange={e => setForm(f => ({ ...f, market_name: e.target.value }))}>
                {MARKETS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Quality observed</label>
              <select className="input" value={form.quality_grade} onChange={e => setForm(f => ({ ...f, quality_grade: e.target.value }))}>
                <option value="A">Grade A — Excellent</option>
                <option value="B">Grade B — Good</option>
                <option value="C">Grade C — Fair</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <input className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Prices rising due to low supply" />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {saving
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : editingId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Record Price'}
            </button>
            {editingId && (
              <button type="button" onClick={cancelEdit} className="btn-secondary">Cancel</button>
            )}
          </div>
        </form>
      </div>

      {/* Today's records */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-700 mb-4">Today's records</h2>
        {loading ? (
          <div className="py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
        ) : todaysRecords.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No prices recorded yet today.</p>
        ) : (
          <div className="space-y-0">
            {todaysRecords.map(r => {
              const prev = r.prev_price != null ? Number(r.prev_price) : null
              const price = Number(r.price_per_kg)
              const change = prev ? ((price - prev) / prev * 100) : null
              return (
                <div key={r.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="font-medium text-gray-900">{r.crop_name}</p>
                    <p className="text-xs text-gray-400">
                      {r.market_name} · {new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Grade {r.quality_grade}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-bold text-gray-900">RWF {price.toLocaleString()}/kg</p>
                      {change !== null && (
                        <div className={`flex items-center justify-end gap-0.5 text-xs font-medium ${change > 0 ? 'text-success-500' : change < 0 ? 'text-danger-500' : 'text-gray-400'}`}>
                          {change > 0 ? <TrendingUp className="w-3 h-3" /> : change < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                          {change !== 0 ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%` : 'No change'}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary-600" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={deletingId === r.id}
                        className="p-1.5 rounded hover:bg-danger-50 text-gray-400 hover:text-danger-500 disabled:opacity-50"
                        title="Delete"
                      >
                        {deletingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
