import { useState } from 'react'
import { ClipboardList, CheckCircle } from 'lucide-react'
import { marketAgentApi } from '../../api/marketAgent.js'
import toast from 'react-hot-toast'

const CONDITION_OPTIONS = [
  { code: 'HEAT_DAMAGE',           label: 'Heat damage' },
  { code: 'PHYSICAL_DAMAGE',       label: 'Physical damage' },
  { code: 'PRE_EXISTING_SPOILAGE', label: 'Spoilage' },
  { code: 'DELAY',                 label: 'Delay' },
]

const EMPTY = {
  batch_reference: '',
  quantity_collected_kg: '',
  quantity_arrived_at_stall_kg: '',
  condition_codes: [],
  condition_notes: '',
}

export default function ClaimsPage() {
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState([])

  const toggleCondition = (code) => {
    setForm(f => ({
      ...f,
      condition_codes: f.condition_codes.includes(code)
        ? f.condition_codes.filter(c => c !== code)
        : [...f.condition_codes, code],
    }))
  }

  const lossKg = () => {
    const c = parseFloat(form.quantity_collected_kg)
    const a = parseFloat(form.quantity_arrived_at_stall_kg)
    if (!isNaN(c) && !isNaN(a) && c > 0) return Math.max(0, c - a)
    return null
  }
  const lossPct = () => {
    const c = parseFloat(form.quantity_collected_kg)
    const loss = lossKg()
    if (loss !== null && c > 0) return ((loss / c) * 100).toFixed(1)
    return null
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const c = parseFloat(form.quantity_collected_kg)
    const a = parseFloat(form.quantity_arrived_at_stall_kg)
    if (!c || c <= 0) { toast.error('Enter quantity collected'); return }
    if (!a || a <= 0) { toast.error('Enter quantity arrived'); return }
    if (a > c) { toast.error('Arrived quantity cannot exceed collected quantity'); return }

    setLoading(true)
    try {
      const payload = {
        quantity_collected_kg: c,
        collected_at: new Date().toISOString(),
        quantity_arrived_at_stall_kg: a,
        arrived_at: new Date().toISOString(),
        condition_codes: form.condition_codes,
        condition_notes: [
          form.batch_reference ? `Batch ref: ${form.batch_reference}` : '',
          form.condition_notes,
        ].filter(Boolean).join(' | '),
      }
      const res = await marketAgentApi.recordCollection(payload)
      const lp = res.data.self_transport_loss_pct ?? lossPct() ?? 0
      setSubmitted(prev => [{ ...res.data, _loss_pct: lp, _ref: form.batch_reference }, ...prev])
      toast.success(`Collection recorded — ${lp}% transit loss`)
      setForm(EMPTY)
    } catch {
      toast.error('Failed to submit. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Claims</h1>
        <p className="text-sm text-gray-500 mt-0.5">Record a collection after picking up produce from a distributor.</p>
      </div>

      {/* Form */}
      <div className="card max-w-2xl">
        <h2 className="text-base font-semibold text-gray-700 mb-5">Record Collection</h2>
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="label">Batch reference (optional)</label>
            <input
              className="input"
              placeholder="e.g. BCH-2026-001"
              value={form.batch_reference}
              onChange={e => setForm(f => ({ ...f, batch_reference: e.target.value }))}
            />
            <p className="text-xs text-gray-400 mt-1">Scan or type the batch code from the distributor's QR label.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Quantity Collected (kg)</label>
              <input
                type="number" min="0" step="0.01" className="input"
                placeholder="0"
                value={form.quantity_collected_kg}
                onChange={e => setForm(f => ({ ...f, quantity_collected_kg: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label">Quantity Arrived (kg)</label>
              <input
                type="number" min="0" step="0.01" className="input"
                placeholder="0"
                value={form.quantity_arrived_at_stall_kg}
                onChange={e => setForm(f => ({ ...f, quantity_arrived_at_stall_kg: e.target.value }))}
                required
              />
            </div>
          </div>

          {/* Live loss preview */}
          {lossPct() !== null && (
            <div className={`rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 ${
              parseFloat(lossPct()) > 10
                ? 'bg-danger-50 text-danger-700'
                : parseFloat(lossPct()) > 5
                ? 'bg-warning-50 text-warning-700'
                : 'bg-success-50 text-success-700'
            }`}>
              Transit loss: {lossKg()} kg ({lossPct()}%)
            </div>
          )}

          <div>
            <label className="label">Condition Issues</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {CONDITION_OPTIONS.map(opt => (
                <label key={opt.code} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.condition_codes.includes(opt.code)}
                    onChange={() => toggleCondition(opt.code)}
                    className="w-4 h-4 accent-primary-600"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Additional notes</label>
            <textarea
              className="input min-h-[70px] resize-none"
              placeholder="Any other observations…"
              value={form.condition_notes}
              onChange={e => setForm(f => ({ ...f, condition_notes: e.target.value }))}
            />
          </div>

          <button
            type="submit" disabled={loading}
            className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Submitting…' : 'Submit Collection Record'}
          </button>
        </form>
      </div>

      {/* Submitted this session */}
      {submitted.length > 0 && (
        <div className="card max-w-2xl">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Submitted this session</h2>
          <div className="space-y-2">
            {submitted.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {c._ref || `Collection #${c.id}`} — {c.quantity_collected_kg} kg collected
                  </p>
                  <p className="text-xs text-gray-400">
                    {c.quantity_arrived_at_stall_kg} kg arrived
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${parseFloat(c._loss_pct) > 5 ? 'text-warning-500' : 'text-success-600'}`}>
                    {c._loss_pct}% loss
                  </span>
                  <CheckCircle className="w-4 h-4 text-success-500" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
