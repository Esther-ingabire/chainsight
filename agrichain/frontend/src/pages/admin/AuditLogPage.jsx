import { useState, useEffect, useCallback } from 'react'
import { Search, Download, X } from 'lucide-react'
import { authApi } from '../../api/auth.js'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

// 4 semantic groups — keeps the colour palette disciplined
const ACTION_SEVERITY = {
  FAILED_LOGIN:      'badge-red',
  PERMISSION_DENIED: 'badge-red',
  DATA_DELETED:      'badge-red',
  ACCOUNT_SUSPENDED: 'badge-red',
  DATA_UPDATED:      'badge-amber',
  LOGIN:             'badge-green',
  OTP_VERIFIED:      'badge-green',
  ACCOUNT_ACTIVATED: 'badge-green',
}

const ACTIONS = [
  'ALL', 'LOGIN', 'FAILED_LOGIN', 'LOGOUT', 'ACCOUNT_CREATED',
  'PASSWORD_CHANGED', 'DATA_CREATED', 'DATA_UPDATED', 'PERMISSION_DENIED', 'REPORT_DOWNLOADED',
]

const EMPTY_FILTERS = { action: 'ALL', search: '', date_from: '', date_to: '' }
const PAGE_SIZE = 50

export default function AuditLogPage() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async (p = 1, overrideFilters) => {
    setLoading(true)
    const f = overrideFilters ?? filters
    try {
      const params = { page: p, page_size: PAGE_SIZE }
      if (f.action !== 'ALL') params.action = f.action
      if (f.search) params.search = f.search
      if (f.date_from) params.date_from = f.date_from
      if (f.date_to) params.date_to = f.date_to
      const res = await authApi.getAuditLogs(params)
      setLogs(res.data.results || res.data || [])
      setTotal(res.data.count || 0)
      setPage(p)
    } catch {
      toast.error('Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [filters])

  // Runs on mount (initial values) and whenever action or dates change.
  // Search is excluded — that requires explicit submit.
  useEffect(() => { load(1) }, [filters.action, filters.date_from, filters.date_to])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    setFilters(f => ({ ...f, search: searchInput }))
    load(1, { ...filters, search: searchInput })
  }

  const clearFilters = () => {
    setSearchInput('')
    setFilters(EMPTY_FILTERS)
    load(1, EMPTY_FILTERS)
  }

  const hasActiveFilters = filters.action !== 'ALL' || filters.search || filters.date_from || filters.date_to

  const exportCsv = async () => {
    if (total === 0) { toast.error('No log entries to export.'); return }
    const toastId = toast.loading(`Exporting ${total.toLocaleString()} entries…`)
    setExporting(true)
    try {
      const params = {}
      if (filters.action !== 'ALL') params.action = filters.action
      if (filters.search) params.search = filters.search
      if (filters.date_from) params.date_from = filters.date_from
      if (filters.date_to) params.date_to = filters.date_to

      // The current page's `logs` is at most PAGE_SIZE rows — a compliance export needs
      // every row matching the active filters, not just what's on screen, so fetch every
      // page rather than exporting a silently-truncated file.
      const totalPages = Math.ceil(total / PAGE_SIZE)
      const allLogs = []
      for (let p = 1; p <= totalPages; p++) {
        const res = await authApi.getAuditLogs({ ...params, page: p, page_size: PAGE_SIZE })
        allLogs.push(...(res.data.results || res.data || []))
      }

      const rows = [['Timestamp', 'Action', 'User', 'Description', 'IP Address']]
      allLogs.forEach(l => rows.push([l.timestamp, l.action, l.user?.phone_number || 'System', l.description, l.ip_address || '']))
      const csv = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${allLogs.length.toLocaleString()} entries`, { id: toastId })
    } catch {
      toast.error('Could not export audit log', { id: toastId })
    } finally {
      setExporting(false)
    }
  }

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">Immutable record of all system activity. {total.toLocaleString()} total events.</p>
        </div>
        <button onClick={exportCsv} disabled={exporting} className="btn-primary flex items-center gap-2 disabled:opacity-60">
          <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1 min-w-48 items-end">
            <div className="flex-1">
              <label className="label">Search user or description</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="Phone number, description…"
                  className="input pl-9"
                />
              </div>
            </div>
            <button type="submit" className="btn-primary whitespace-nowrap">Search</button>
          </form>

          {/* Action — auto-applies on change */}
          <div>
            <label className="label">Action type</label>
            <select
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
              className="input"
            >
              {ACTIONS.map(a => <option key={a} value={a}>{a === 'ALL' ? 'All Actions' : a.replace(/_/g, ' ')}</option>)}
            </select>
          </div>

          {/* Date from — auto-applies on change */}
          <div>
            <label className="label">From</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
              className="input"
            />
          </div>

          {/* Date to — auto-applies on change */}
          <div>
            <label className="label">To</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
              className="input"
            />
          </div>

          {/* Clear */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-danger-600 border border-gray-200 hover:border-danger-300 rounded-xl transition-colors whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" /> Clear filters
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
            {filters.action !== 'ALL' && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 px-2.5 py-1 rounded-full">
                Action: {filters.action}
                <button onClick={() => setFilters(f => ({ ...f, action: 'ALL' }))} className="hover:text-primary-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {filters.search && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
                Search: "{filters.search}"
                <button onClick={() => { setSearchInput(''); setFilters(f => ({ ...f, search: '' })); load(1, { ...filters, search: '' }) }} className="hover:text-gray-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {filters.date_from && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
                From: {filters.date_from}
                <button onClick={() => setFilters(f => ({ ...f, date_from: '' }))} className="hover:text-gray-900"><X className="w-3 h-3" /></button>
              </span>
            )}
            {filters.date_to && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
                To: {filters.date_to}
                <button onClick={() => setFilters(f => ({ ...f, date_to: '' }))} className="hover:text-gray-900"><X className="w-3 h-3" /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? [1,2,3,4,5].map(i => (
                <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-7 bg-gray-100 rounded animate-pulse" /></td></tr>
              )) : logs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400">
                  {hasActiveFilters ? 'No events match these filters.' : 'No audit events recorded yet.'}
                </td></tr>
              ) : logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 font-mono text-xs">
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{log.timestamp ? format(new Date(log.timestamp), 'dd MMM yyyy HH:mm:ss') : '—'}</td>
                  <td className="px-4 py-2.5"><span className={ACTION_SEVERITY[log.action] || 'badge-gray'}>{log.action?.replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-2.5 text-gray-600 font-sans">{log.user?.phone_number || <span className="text-gray-400 italic">System</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate font-sans">{log.description}</td>
                  <td className="px-4 py-2.5 text-gray-400">{log.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <p className="text-xs text-gray-500">Showing {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, total)} of {total.toLocaleString()}</p>
            <div className="flex gap-1">
              <button onClick={() => load(page-1)} disabled={page <= 1} className="px-3 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-100">Previous</button>
              <button onClick={() => load(page+1)} disabled={page >= pages} className="px-3 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-100">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
