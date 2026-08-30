import { Bell, X, CheckCheck, AlertTriangle, Info, Settings, LogOut, User } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyticsApi } from '../../api/analytics.js'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'

const ROLE_LABELS = {
  ADMIN: 'ADMIN', COOPERATIVE_MANAGER: 'COOPERATIVE MANAGER',
  TRANSPORTER: 'TRANSPORTER', TRANSPORT_COMPANY: 'TRANSPORT COMPANY', DISTRIBUTOR: 'DISTRIBUTOR',
  MARKET_AGENT: 'MARKET AGENT', MINAGRI_OFFICER: 'MINAGRI OFFICER',
}

function mapApiNotification(n) {
  return {
    id: n.id,
    Icon: Info,
    iconCls: 'text-primary-600 bg-primary-50',
    title: n.title || 'Notification',
    body: n.message || '',
    ts: new Date(n.created_at),
    read: n.is_read,
    relatedType: n.related_object_type,
    relatedId: n.related_object_id,
  }
}

// MINAGRI's rule-based alerts (district loss threshold breaches, stale transport requests) are
// computed live from real data on every request — they have no DB row/id, so they're display-only:
// markRead just flips local state instead of calling the API (see isLocalOnly below).
const MINAGRI_ALERT_ICON = { CRITICAL: AlertTriangle, WARNING: AlertTriangle, INFO: Info }
const MINAGRI_ALERT_CLS  = {
  CRITICAL: 'text-danger-600 bg-danger-50',
  WARNING:  'text-warning-600 bg-warning-50',
  INFO:     'text-primary-600 bg-primary-50',
}
function mapMinagriAlert(a, i) {
  return {
    id: `minagri-alert-${i}`,
    Icon: MINAGRI_ALERT_ICON[a.type] || Info,
    iconCls: MINAGRI_ALERT_CLS[a.type] || MINAGRI_ALERT_CLS.INFO,
    title: a.title,
    body: a.body,
    ts: new Date(a.created_at),
    read: !a.unread,
    isLocalOnly: true,
  }
}

// Where each role's batch-detail page lives — used to deep-link a "batch" notification
// (e.g. a transporter's incident report) straight to that batch instead of just a toast.
const ROLE_BATCH_DETAIL_PATH = {
  COOPERATIVE_MANAGER: '/cooperative/traceability',
  DISTRIBUTOR: '/distributor/traceability',
}

const ROLE_SETTINGS_PATH = {
  ADMIN: '/admin/settings',
  COOPERATIVE_MANAGER: '/cooperative/settings',
  TRANSPORTER: '/transporter/settings',
  TRANSPORT_COMPANY: '/transporter/settings',
  DISTRIBUTOR: '/distributor/settings',
  MARKET_AGENT: '/market-agent/settings',
  MINAGRI_OFFICER: '/minagri/settings',
}

export default function TopBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const panelRef = useRef(null)
  const profileRef = useRef(null)

  const unread = notifications.filter(n => !n.read).length

  // ── Step 1: initial REST load — generic account notifications, plus MINAGRI's
  // live rule-based alerts merged in so the bell is the single place to see everything. ──
  useEffect(() => {
    const isMinagri = user?.role === 'MINAGRI_OFFICER'
    Promise.allSettled([
      analyticsApi.getNotifications({ page_size: 20 }),
      isMinagri ? analyticsApi.getMinagriAlerts() : Promise.resolve(null),
    ]).then(([genRes, minagriRes]) => {
      const generic = genRes.status === 'fulfilled' ? (genRes.value.data?.results || []).map(mapApiNotification) : []
      const minagriAlerts = isMinagri && minagriRes.status === 'fulfilled'
        ? (minagriRes.value.data?.alerts || []).map(mapMinagriAlert)
        : []
      const combined = [...minagriAlerts, ...generic].sort((a, b) => b.ts - a.ts)
      setNotifications(combined)
    })
  }, [user?.role])

  // ── Step 2: SSE for real-time new notifications ────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token || !user) return

    const base = import.meta.env.VITE_API_URL || '/api/v1'
    const url  = `${base}/notifications/stream/?token=${encodeURIComponent(token)}`
    const es   = new EventSource(url)

    es.onmessage = (e) => {
      try {
        const n = JSON.parse(e.data)
        const mapped = mapApiNotification(n)
        setNotifications(prev => {
          if (prev.some(p => p.id === n.id)) return prev   // no duplicates
          return [mapped, ...prev]
        })
        // Push a toast so the user sees it even when the panel is closed
        toast(n.title, {
          icon: '🔔',
          style: { fontSize: '13px' },
          duration: 4000,
        })
      } catch { /* ignore malformed events */ }
    }

    es.onerror = () => {
      // EventSource auto-reconnects — nothing to do here
    }

    return () => es.close()
  }, [user?.id])

  // ── Close panels on outside click ─────────────────────────────────────────
  useEffect(() => {
    if (!open && !profileOpen) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, profileOpen])

  const markAllRead = () => {
    analyticsApi.markAllRead().catch(() => {})
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase()

  return (
    <header className="h-14 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 flex items-center justify-between px-6 flex-shrink-0 sticky top-0 z-30">
      <div />
      <div className="flex items-center gap-2">
        {(user?.role === 'TRANSPORTER' || user?.role === 'TRANSPORT_COMPANY') && (
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600 mr-1">
            <span className="text-gray-400">Status:</span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-50 border border-success-200 text-success-700 text-xs font-semibold">
              <span className="w-1.5 h-1.5 bg-success-500 rounded-full" />
              Available
            </span>
          </div>
        )}

        {/* Notifications */}
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setOpen(o => !o)}
            className="relative w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-700 bg-white/60 hover:bg-white border border-gray-200/70 rounded-xl transition-all backdrop-blur-sm shadow-sm"
          >
            <Bell className="w-[18px] h-[18px]" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-danger-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-11 w-80 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/60 z-50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">Notifications</span>
                  {unread > 0 && (
                    <span className="text-[10px] font-bold text-white bg-danger-500 px-1.5 py-0.5 rounded-full">{unread}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unread > 0 && (
                    <button onClick={markAllRead} className="text-xs text-primary-600 hover:underline flex items-center gap-1">
                      <CheckCheck className="w-3.5 h-3.5" />
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => setOpen(false)} className="p-1 hover:bg-gray-200/60 backdrop-blur-sm rounded-lg transition-colors">
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {notifications.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bell className="w-8 h-8 mx-auto text-gray-200 mb-2" />
                    <p className="text-sm font-medium text-gray-400">You're all caught up!</p>
                    <p className="text-xs text-gray-300 mt-0.5">No new notifications.</p>
                  </div>
                ) : notifications.map(n => {
                  const NIcon = n.Icon
                  const batchPath = n.relatedType === 'batch' && n.relatedId
                    ? ROLE_BATCH_DETAIL_PATH[user?.role]
                    : null
                  const handleClick = () => {
                    if (!n.read) {
                      if (!n.isLocalOnly) analyticsApi.markRead(n.id).catch(() => {})
                      setNotifications(prev => prev.map(p => p.id === n.id ? { ...p, read: true } : p))
                    }
                    if (batchPath) {
                      setOpen(false)
                      navigate(`${batchPath}?batch=${n.relatedId}`)
                    }
                  }
                  return (
                    <div key={n.id} onClick={handleClick}
                      className={`flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50 ${!n.read ? 'bg-primary-50/40' : ''} ${batchPath ? 'cursor-pointer' : ''}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${n.iconCls}`}>
                        <NIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm text-gray-800 leading-snug ${!n.read ? 'font-semibold' : 'font-medium'}`}>{n.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5 leading-snug">{n.body}</p>
                        <p className="text-[11px] text-gray-300 mt-1">
                          {formatDistanceToNow(n.ts, { addSuffix: true })}
                          {batchPath && <span className="text-primary-600 font-medium ml-2">View batch →</span>}
                        </p>
                      </div>
                      {!n.read && <div className="w-2 h-2 bg-primary-500 rounded-full mt-2.5 flex-shrink-0" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Avatar + profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen(o => !o)}
            className="flex items-center gap-2.5 bg-white/60 hover:bg-white border border-gray-200/70 rounded-xl px-2 py-1 transition-all backdrop-blur-sm shadow-sm"
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="avatar"
                className="w-8 h-8 rounded-full object-cover border border-gray-200 flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                {initials}
              </div>
            )}
            <div className="hidden md:block leading-tight text-left">
              <p className="text-sm font-semibold text-gray-800 leading-none">{user?.first_name} {user?.last_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{ROLE_LABELS[user?.role] || user?.role?.replace(/_/g, ' ')}</p>
            </div>
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-11 w-64 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/60 z-50 overflow-hidden">
              {/* User info header */}
              <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="avatar"
                    className="w-11 h-11 rounded-full object-cover border border-gray-200 flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-primary-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{user?.first_name} {user?.last_name}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.phone_number}</p>
                  <p className="text-xs text-primary-600 font-medium mt-0.5">{ROLE_LABELS[user?.role]}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="py-1">
                <button
                  onClick={() => { setProfileOpen(false); navigate(ROLE_SETTINGS_PATH[user?.role] || '/settings') }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="w-4 h-4 text-gray-400" />
                  Edit profile & photo
                </button>
                <button
                  onClick={() => { setProfileOpen(false); navigate(ROLE_SETTINGS_PATH[user?.role] || '/settings') }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Settings className="w-4 h-4 text-gray-400" />
                  Settings
                </button>
              </div>

              <div className="border-t border-gray-100 py-1">
                <button
                  onClick={() => { setProfileOpen(false); logout() }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger-600 hover:bg-danger-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </header>
  )
}
