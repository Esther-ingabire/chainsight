import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Search, UserPlus, X, UserCheck, UserX, RefreshCw, Eye, Phone, Mail, MapPin, Building2, Calendar } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { authApi } from '../../api/auth.js'
import toast from 'react-hot-toast'

const ROLES = ['ALL', 'COOPERATIVE_MANAGER', 'TRANSPORT_COMPANY', 'TRANSPORTER', 'DISTRIBUTOR', 'MARKET_AGENT', 'MINAGRI_OFFICER', 'WAREHOUSE_MANAGER']
// Every other role already has a self-service Request Access flow reviewed via the
// Registration Queue — creating them here too would be a second, unreviewed path to the
// same accounts. MINAGRI Officer has no public request form at all, so it's the one role
// that genuinely needs a direct-create path.
const CREATABLE_ROLES = ['MINAGRI_OFFICER']
const ROLE_LABELS = { ADMIN: 'Admin', COOPERATIVE_MANAGER: 'Coop Manager', TRANSPORT_COMPANY: 'Transport Company', TRANSPORTER: 'Transporter (Driver)', DISTRIBUTOR: 'Distributor', MARKET_AGENT: 'Market Agent', MINAGRI_OFFICER: 'MINAGRI Officer', WAREHOUSE_MANAGER: 'Warehouse Manager' }
const ROLE_BADGE = { ADMIN: 'badge-red', COOPERATIVE_MANAGER: 'badge-green', TRANSPORT_COMPANY: 'badge-amber', TRANSPORTER: 'badge-gray', DISTRIBUTOR: 'badge-primary', MARKET_AGENT: 'badge-blue', MINAGRI_OFFICER: 'badge-gray', WAREHOUSE_MANAGER: 'badge-blue' }
const PAGE_SIZE = 50

const createSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  phone_number: z.string().min(10, 'Enter a valid phone number'),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  role: z.enum(CREATABLE_ROLES, { required_error: 'Select a role' }),
  organization_name: z.string().optional(),
  district: z.string().optional(),
})

function Field({ label, value, icon: Icon }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
        <p className="text-xs text-gray-400">{label}</p>
      </div>
      <p className="text-sm font-medium text-gray-900">{value || '—'}</p>
    </div>
  )
}

function ViewUserModal({ user, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center text-primary-600 font-semibold text-sm">
              {user.first_name?.[0]}{user.last_name?.[0]}
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{user.first_name} {user.last_name}</h2>
              <span className={`${ROLE_BADGE[user.role] || 'badge-gray'} text-xs`}>{ROLE_LABELS[user.role] || user.role}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone number" value={user.phone_number} icon={Phone} />
            <Field label="Email address" value={user.email} icon={Mail} />
            <Field label="Organisation" value={user.organization_name} icon={Building2} />
            <Field label="District" value={user.district} icon={MapPin} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account status" value={user.is_active ? 'Active' : 'Suspended'} />
            <Field
              label="Member since"
              value={user.created_at ? format(new Date(user.created_at), 'dd MMM yyyy') : undefined}
              icon={Calendar}
            />
          </div>
        </div>
        <div className="px-6 pb-6">
          <button onClick={onClose} className="w-full btn-secondary">Close</button>
        </div>
      </div>
    </div>
  )
}

function SuspendConfirmModal({ user, onClose, onConfirm, loading }) {
  const isSuspending = user.is_active
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6 text-center">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${isSuspending ? 'bg-warning-50' : 'bg-success-50'}`}>
            {isSuspending
              ? <UserX className="w-6 h-6 text-warning-500" />
              : <UserCheck className="w-6 h-6 text-success-500" />
            }
          </div>
          <h2 className="text-base font-semibold text-gray-900 mb-2">
            {isSuspending ? 'Suspend account?' : 'Activate account?'}
          </h2>
          <p className="text-sm text-gray-500">
            {isSuspending
              ? <>Are you sure you want to suspend <span className="font-medium text-gray-700">{user.first_name} {user.last_name}</span>? They won't be able to log in until reactivated.</>
              : <>Reactivate <span className="font-medium text-gray-700">{user.first_name} {user.last_name}</span>? They will be able to log in immediately.</>
            }
          </p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="btn-secondary flex-1" disabled={loading}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-60 ${isSuspending ? 'bg-warning-500 hover:bg-warning-600' : 'bg-success-500 hover:bg-success-600'}`}>
            {loading
              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : isSuspending ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />
            }
            {loading ? 'Saving…' : isSuspending ? 'Suspend' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddUserModal({ onClose, onCreated }) {
  const [saving, setSaving] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(createSchema),
    defaultValues: { email: '', organization_name: '', district: '', role: CREATABLE_ROLES[0] },
  })

  const onSubmit = async (data) => {
    setSaving(true)
    const payload = { ...data }
    if (!payload.email) delete payload.email
    if (!payload.organization_name) delete payload.organization_name
    if (!payload.district) delete payload.district
    try {
      const res = await authApi.createUser(payload)
      toast.success(`Account created. OTP sent to ${data.email || data.phone_number}`)
      onCreated(res.data.user)
    } catch (err) {
      const msg = err.response?.data ? Object.values(err.response.data).flat().join(' ') : 'Failed to create user'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add MINAGRI Officer</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">First name *</label>
              <input {...register('first_name')} className="input" />
              {errors.first_name && <p className="text-danger-500 text-xs mt-1">{errors.first_name.message}</p>}
            </div>
            <div>
              <label className="label">Last name *</label>
              <input {...register('last_name')} className="input" />
              {errors.last_name && <p className="text-danger-500 text-xs mt-1">{errors.last_name.message}</p>}
            </div>
          </div>
          <div>
            <label className="label">Phone number *</label>
            <input {...register('phone_number')} className="input" placeholder="+250 7XX XXX XXX" />
            {errors.phone_number && <p className="text-danger-500 text-xs mt-1">{errors.phone_number.message}</p>}
          </div>
          <div>
            <label className="label">Email (for OTP delivery)</label>
            <input {...register('email')} type="email" className="input" placeholder="user@example.com" />
            {errors.email && <p className="text-danger-500 text-xs mt-1">{errors.email.message}</p>}
          </div>
          <div>
            <label className="label">Role</label>
            <input type="hidden" {...register('role')} />
            <p className="input bg-gray-50 text-gray-500">{ROLE_LABELS[CREATABLE_ROLES[0]]}</p>
            <p className="text-xs text-gray-400 mt-1">
              Every other role signs up through Request Access and is reviewed in the Registration Queue.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Organisation</label>
              <input {...register('organization_name')} className="input" placeholder="Optional" />
            </div>
            <div>
              <label className="label">District</label>
              <input {...register('district')} className="input" placeholder="Optional" />
            </div>
          </div>
          <p className="text-xs text-gray-400">A temporary password will be generated. The user receives an OTP to activate their account and will be asked to set a new password on first login.</p>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <UserPlus className="w-4 h-4" />}
              {saving ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function UserManagement() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [showAddModal, setShowAddModal] = useState(false)
  const [viewUser, setViewUser] = useState(null)
  const [suspendTarget, setSuspendTarget] = useState(null)
  const [suspending, setSuspending] = useState(false)

  const load = async (p = 1) => {
    setLoading(true)
    try {
      const params = { page: p }
      if (roleFilter !== 'ALL') params.role = roleFilter
      if (search) params.search = search
      const res = await authApi.getUsers(params)
      setUsers(res.data.results || res.data || [])
      setTotal(res.data.count || res.data?.length || 0)
      setPage(p)
    } catch { toast.error('Failed to load users') }
    finally { setLoading(false) }
  }

  useEffect(() => { load(1) }, [roleFilter])

  const handleSearch = (e) => { e.preventDefault(); load(1) }
  const pages = Math.ceil(total / PAGE_SIZE)

  const confirmToggleActive = async () => {
    if (!suspendTarget) return
    setSuspending(true)
    try {
      await authApi.updateUser(suspendTarget.id, { is_active: !suspendTarget.is_active })
      toast.success(`User ${suspendTarget.is_active ? 'suspended' : 'activated'}`)
      setSuspendTarget(null)
      load(page)
    } catch { toast.error('Action failed') }
    finally { setSuspending(false) }
  }

  return (
    <div className="space-y-6">
      {showAddModal && (
        <AddUserModal
          onClose={() => setShowAddModal(false)}
          onCreated={(newUser) => { setUsers(prev => [newUser, ...prev]); setTotal(t => t + 1); setShowAddModal(false) }}
        />
      )}

      {viewUser && (
        <ViewUserModal user={viewUser} onClose={() => setViewUser(null)} />
      )}

      {suspendTarget && (
        <SuspendConfirmModal
          user={suspendTarget}
          loading={suspending}
          onClose={() => setSuspendTarget(null)}
          onConfirm={confirmToggleActive}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} registered users</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Add MINAGRI Officer
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3 items-center">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-64">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, email…" className="input pl-9" />
            </div>
            <button type="submit" className="btn-primary px-4">Search</button>
          </form>
          <div className="flex gap-1 flex-wrap">
            {ROLES.map(r => (
              <button key={r} onClick={() => setRoleFilter(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${roleFilter === r ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {r === 'ALL' ? 'All Roles' : ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Organisation</th>
                <th className="px-4 py-3 font-medium">District</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><div className="h-8 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : users.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No users found</td></tr>
              ) : users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{u.first_name} {u.last_name}</p>
                      <p className="text-xs text-gray-400">{u.phone_number}</p>
                      {u.email && <p className="text-xs text-gray-400">{u.email}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={ROLE_BADGE[u.role] || 'badge-gray'}>{ROLE_LABELS[u.role] || u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.organization_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{u.district || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${u.is_active ? 'badge-green' : 'badge-gray'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-success-500' : 'bg-gray-400'}`} />
                      {u.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {u.created_at ? formatDistanceToNow(new Date(u.created_at), { addSuffix: true }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setViewUser(u)}
                        title="View user details"
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-primary-600 transition-colors">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setSuspendTarget(u)}
                        title={u.is_active ? 'Suspend account' : 'Activate account'}
                        className={`p-1.5 rounded-lg transition-colors ${u.is_active ? 'hover:bg-warning-50 text-gray-400 hover:text-warning-500' : 'hover:bg-success-50 text-gray-400 hover:text-success-500'}`}>
                        {u.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}</p>
            <div className="flex gap-2">
              <button onClick={() => load(page - 1)} disabled={page <= 1} className="px-3 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-100">Previous</button>
              <button onClick={() => load(page + 1)} disabled={page >= pages} className="px-3 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-100">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
