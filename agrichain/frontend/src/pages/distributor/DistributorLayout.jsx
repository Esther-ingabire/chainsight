import { Routes, Route, Navigate } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, Settings, FileDown, QrCode, Trash2, Users, UserCheck, Thermometer, CheckCircle, TrendingUp } from 'lucide-react'
import Sidebar from '../../components/layout/Sidebar.jsx'
import TopBar from '../../components/layout/TopBar.jsx'
import DistributorDashboard from './DistributorDashboard.jsx'
import OrderManagement from './OrderManagement.jsx'
import MarketAgents from './MarketAgents.jsx'
import IncomingDeliveries from './IncomingDeliveries.jsx'
import DistributorTraceability from './DistributorTraceability.jsx'
import DistributorFleetMonitoring from './DistributorFleetMonitoring.jsx'
import WasteReportPage from './WasteReportPage.jsx'
import DeliveryConfirmations from './DeliveryConfirmations.jsx'
import Transporters from './Transporters.jsx'
import MarketPrices from './MarketPrices.jsx'
import SettingsPage from '../shared/SettingsPage.jsx'
import RoleReportsPage from '../shared/RoleReportsPage.jsx'

const navItems = [
  { to: '/distributor',              label: 'Dashboard',             icon: LayoutDashboard, end: true },
  { to: '/distributor/orders',       label: 'Orders & Cooperatives', icon: ClipboardList },
  { to: '/distributor/agents',       label: 'Market Agents',         icon: UserCheck },
  { to: '/distributor/collections',  label: 'Delivery Confirmations',icon: CheckCircle },
  { to: '/distributor/transporters',    label: 'Transporters',     icon: Users },
  { to: '/distributor/fleet-monitoring',label: 'Fleet Monitoring', icon: Thermometer },
  { to: '/distributor/traceability',    label: 'Traceability',     icon: QrCode },
  { to: '/distributor/market-prices',   label: 'Market Prices',    icon: TrendingUp },
  { to: '/distributor/waste',        label: 'Waste Report',          icon: Trash2 },
  { to: '/distributor/reports',      label: 'Reports',               icon: FileDown },
  { to: '/distributor/settings',     label: 'Settings',              icon: Settings },
]

export default function DistributorLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar navItems={navItems} title="Distributor" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route index element={<DistributorDashboard />} />
            <Route path="orders"       element={<OrderManagement />} />
            <Route path="agent-orders" element={<Navigate to="/distributor/agents" replace />} />
            <Route path="agents"       element={<MarketAgents />} />
            <Route path="collections"  element={<DeliveryConfirmations />} />
            <Route path="deliveries"   element={<IncomingDeliveries />} />
            <Route path="transporters"     element={<Transporters />} />
            <Route path="fleet-monitoring" element={<DistributorFleetMonitoring />} />
            <Route path="traceability" element={<DistributorTraceability />} />
            <Route path="market-prices" element={<MarketPrices />} />
            <Route path="waste"        element={<WasteReportPage />} />
            <Route path="reports"      element={<RoleReportsPage />} />
            <Route path="settings"     element={<SettingsPage />} />
            <Route path="*"            element={<Navigate to="/distributor" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
