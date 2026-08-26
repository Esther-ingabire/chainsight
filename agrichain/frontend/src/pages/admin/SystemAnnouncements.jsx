import { useState, useEffect } from 'react'
import { Megaphone, Plus, Pencil, Trash2, X, Check, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { analyticsApi } from '../../api/analytics.js'

export default function SystemAnnouncements() {
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: '', body: '' })
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = () => {
    setLoading(true)
    analyticsApi.getAnnouncements()
      .then(res => setAnnouncements(res.data?.results ?? res.data ?? []))
      .catch(() => toast.error('Could not load announcements'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const openNew = () => { setForm({ title: '', body: '' }); setEditing(null); setShowForm(true) }
  const openEdit = (a) => { setForm({ title: a.title, body: a.body }); setEditing(a.id); setShowForm(true) }

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) { toast.error('Title and body required'); return }
    setSaving(true)
    try {
      if (editing) {
        const res = await analyticsApi.updateAnnouncement(editing, form)
        setAnnouncements(prev => prev.map(a => a.id === editing ? res.data : a))
        toast.success('Announcement updated')
      } else {
        const res = await analyticsApi.createAnnouncement(form)
        setAnnouncements(prev => [res.data, ...prev])
        toast.success('Announcement posted — every user has been notified')
      }
      setShowForm(false)
    } catch (err) {
      const raw = err.response?.data
      const msg = raw ? Object.values(raw).flat().join(' ') : 'Could not save announcement'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const del = async (id) => {
    setBusyId(id)
    try {
      await analyticsApi.deleteAnnouncement(id)
      setAnnouncements(prev => prev.filter(a => a.id !== id))
      toast.success('Deleted')
    } catch {
      toast.error('Could not delete announcement')
    } finally {
      setBusyId(null)
    }
  }

  const toggle = async (a) => {
    setBusyId(a.id)
    try {
      const res = await analyticsApi.updateAnnouncement(a.id, { is_active: !a.is_active })
      setAnnouncements(prev => prev.map(x => x.id === a.id ? res.data : x))
      toast.success(res.data.is_active ? 'Activated — every user has been notified' : 'Deactivated')
    } catch {
      toast.error('Could not update announcement')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Announcements</h1>
          <p className="text-sm text-gray-500 mt-0.5">Posting or reactivating an announcement notifies every user immediately.</p>
        </div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" />New Announcement</button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card border border-primary-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{editing ? 'Edit Announcement' : 'New Announcement'}</h2>
            <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
          <div className="space-y-4">
            <div><label className="label">Title *</label><input className="input" value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} placeholder="Announcement title" /></div>
            <div><label className="label">Message *</label><textarea className="input resize-none" rows={4} value={form.body} onChange={e => setForm(p => ({...p, body: e.target.value}))} placeholder="Write the announcement here…" /></div>
            <div className="flex gap-3">
              <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editing ? 'Save changes' : 'Post announcement'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="card text-center py-12 text-gray-400"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          {announcements.length === 0 && <div className="card text-center py-12 text-gray-400"><Megaphone className="w-10 h-10 mx-auto mb-2 opacity-50" /><p>No announcements yet</p></div>}
          {announcements.map(a => (
            <div key={a.id} className={`card border-2 ${a.is_active ? 'border-primary-500' : 'border-gray-200 opacity-60'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-gray-900">{a.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? 'bg-success-50 text-success-500' : 'bg-gray-100 text-gray-400'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <p className="text-sm text-gray-600">{a.body}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    {format(new Date(a.created_at), 'dd MMM yyyy')}{a.created_by_name && ` · ${a.created_by_name}`}
                  </p>
                </div>
                <div className="flex gap-1 ml-4">
                  <button onClick={() => toggle(a)} disabled={busyId === a.id} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary-600 disabled:opacity-50" title={a.is_active ? 'Deactivate' : 'Activate'}>
                    {a.is_active ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(a)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary-600"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => del(a.id)} disabled={busyId === a.id} className="p-1.5 rounded hover:bg-danger-50 text-gray-400 hover:text-danger-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
