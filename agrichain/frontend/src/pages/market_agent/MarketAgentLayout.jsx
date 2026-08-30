import { Routes, Route, Navigate } from 'react-router-dom'
import { LayoutDashboard, Bell, ShoppingBag, ClipboardList, Trash2, Settings, FileDown, Building2, TrendingUp } from 'lucide-react'
import Sidebar from '../../components/layout/Sidebar.jsx'
import TopBar from '../../components/layout/TopBar.jsx'
import MarketAgentDashboard from './MarketAgentDashboard.jsx'
import NoticesPage from './NoticesPage.jsx'
import OrdersPage from './OrdersPage.jsx'
import FindDistributorsPage from './FindDistributorsPage.jsx'
import ClaimsPage from './ClaimsPage.jsx'
import PriceRecording from './PriceRecording.jsx'
import WasteReportPage from './WasteReportPage.jsx'
import SettingsPage from '../shared/SettingsPage.jsx'
import RoleReportsPage from '../shared/RoleReportsPage.jsx'

const navItems = [
  { to: '/market-agent',          label: 'Dashboard',      icon: LayoutDashboard, end: true },
  { to: '/market-agent/stock',        label: 'Available Stock',    icon: Bell },
  { to: '/market-agent/orders',       label: 'My Orders',          icon: ShoppingBag },
  { to: '/market-agent/distributors', label: 'Find Distributors',  icon: Building2 },
  { to: '/market-agent/claims',   label: 'Claims',         icon: ClipboardList },
  { to: '/market-agent/prices',   label: 'Record Prices',  icon: TrendingUp },
  { to: '/market-agent/waste',    label: 'Waste Report',   icon: Trash2 },
  { to: '/market-agent/reports',  label: 'Reports',        icon: FileDown },
  { to: '/market-agent/settings', label: 'Settings',       icon: Settings },
]

export default function MarketAgentLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar navItems={navItems} title="Market Agent" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route index element={<MarketAgentDashboard />} />
            <Route path="stock"    element={<NoticesPage />} />
            <Route path="notices"  element={<Navigate to="/market-agent/stock" replace />} />
            <Route path="orders"        element={<OrdersPage />} />
            <Route path="distributors"  element={<FindDistributorsPage />} />
            <Route path="claims"   element={<ClaimsPage />} />
            <Route path="prices"   element={<PriceRecording />} />
            <Route path="waste"    element={<WasteReportPage />} />
            <Route path="losses"   element={<Navigate to="/market-agent/reports" replace />} />
            <Route path="reports"  element={<RoleReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/market-agent" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

