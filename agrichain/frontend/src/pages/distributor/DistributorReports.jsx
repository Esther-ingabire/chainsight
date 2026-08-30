import { useState, useEffect, useRef } from 'react'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js'
import { Download, FileSpreadsheet, TrendingDown, Package, Truck, ShoppingCart, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { distributionApi } from '../../api/distribution.js'
import { traceabilityApi } from '../../api/traceability.js'
import { saveAs } from 'file-saver'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const C = { primary: '#1a5c34', self: '#f59e0b', transporter: '#1a5c34', light: '#72be97' }

const DELIVERY_METHOD_LABEL = { SELF_COLLECTION: 'Self-collection', TRANSPORTER_DELIVERY: 'Transporter' }

function downloadCSV(filename, rows, headers) {
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => {
    const v = r[h] ?? ''
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : v
  }).join(','))].join('\n')
  saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
}

export default function DistributorReports() {
  const [section, setSection] = useState('procurement')
  const [monthly, setMonthly] = useState([])
  const [crops, setCrops] = useState([])
  const [lossData, setLossData] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(false)
  const printRef = useRef()

  useEffect(() => {
    setLoading(true)
    distributionApi.getDistributionAnalytics()
      .then(res => {
        const d = res.data
        setMonthly(d.monthly_trend || [])
        setCrops(d.crop_breakdown || [])
        setLossData(d.agent_loss_breakdown || [])
      })
      .catch(() => toast.error('Could not load distribution analytics'))
    traceabilityApi.getBatches()
      .then(res => {
        const list = res.data?.results ?? res.data ?? []
        setBatches(list.map(b => ({
          batch_id: b.batch_id_short,
          crop: b.crop_name,
          cooperative: b.cooperative_name,
          dispatched_kg: Number(b.dispatch_weight_kg || 0),
          received_kg: b.weight_at_distributor_kg != null ? Number(b.weight_at_distributor_kg) : null,
          loss_kg: b.weight_at_distributor_kg != null
            ? Math.max(0, Number(b.dispatch_weight_kg || 0) - Number(b.weight_at_distributor_kg))
            : null,
          loss_pct: b.transit_loss_leg1_pct != null ? Number(b.transit_loss_leg1_pct) : null,
          delivery_method: DELIVERY_METHOD_LABEL[b.delivery_method] || '—',
          date: b.dispatch_timestamp ? b.dispatch_timestamp.slice(0, 10) : '',
        })))
      })
      .catch(() => toast.error('Could not load batch traceability'))
      .finally(() => setLoading(false))
  }, [])

  const totalOrders = monthly.reduce((a, m) => a + m.orders, 0)
  const totalDeliveries = monthly.reduce((a, m) => a + m.deliveries, 0)
  const totalLoss = monthly.reduce((a, m) => a + m.loss_kg, 0)
  const avgSelfLoss = lossData.length ? (lossData.reduce((a, x) => a + x.self_collection_pct, 0) / lossData.length).toFixed(1) : 0
  const avgTransLoss = lossData.length ? (lossData.reduce((a, x) => a + x.transporter_pct, 0) / lossData.length).toFixed(1) : 0

  const procurementChart = {
    labels: monthly.map(m => m.month),
    datasets: [
      { label: 'Orders', data: monthly.map(m => m.orders), backgroundColor: C.primary + 'D9', borderRadius: 5, borderSkipped: false },
      { label: 'Deliveries', data: monthly.map(m => m.deliveries), backgroundColor: C.light + 'CC', borderRadius: 5, borderSkipped: false },
    ],
  }

  const lossChart = {
    labels: lossData.map(d => d.agent),
    datasets: [
      { label: 'Self-Collection Loss %', data: lossData.map(d => d.self_collection_pct), backgroundColor: C.self + 'CC', borderRadius: 5, borderSkipped: false },
      { label: 'Transporter Loss %', data: lossData.map(d => d.transporter_pct), backgroundColor: C.primary + 'D9', borderRadius: 5, borderSkipped: false },
    ],
  }

  const chartOptions = (yLabel = '', max = null) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: {
        grid: { color: '#f3f4f6' },
        ticks: { font: { size: 11 } },
        beginAtZero: true,
        ...(max ? { max } : {}),
        title: yLabel ? { display: true, text: yLabel, font: { size: 11 }, color: '#9ca3af' } : {},
      },
    },
  })

  const handlePrint = () => window.print()

  const downloadProcurementCSV = () => {
    downloadCSV('procurement_report.csv', monthly, ['month', 'orders', 'deliveries', 'loss_kg'])
  }

  const downloadLossCSV = () => {
    downloadCSV('delivery_loss_comparison.csv', lossData, ['agent', 'self_collection_pct', 'transporter_pct', 'batches'])
  }

  const downloadBatchesCSV = () => {
    downloadCSV('batch_traceability.csv', batches, ['batch_id', 'crop', 'cooperative', 'dispatched_kg', 'received_kg', 'loss_kg', 'loss_pct', 'delivery_method', 'date'])
  }

  const SECTIONS = [
    { id: 'procurement', label: 'Procurement Summary' },
    { id: 'loss', label: 'Delivery Loss Comparison' },
    { id: 'batches', label: 'Batch Traceability' },
  ]

  return (
    <div className="space-y-6 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Analytics, delivery loss comparison, and traceability records.</p>
        </div>
        <button onClick={handlePrint} className="btn-secondary flex items-center gap-2 text-sm">
          <Printer className="w-4 h-4" /> Print / Save PDF
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 border-b border-gray-200 print:hidden">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${section === s.id ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div ref={printRef}>

        {/* ── Procurement Summary ── */}
        {section === 'procurement' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between print:hidden">
              <h2 className="text-base font-semibold text-gray-800">Procurement Summary — Last 6 months</h2>
              <button onClick={downloadProcurementCSV} className="btn-secondary text-sm flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" /> Export CSV
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Total orders', value: totalOrders, icon: ShoppingCart, color: 'text-primary-500' },
                { label: 'Deliveries completed', value: totalDeliveries, icon: Truck, color: 'text-success-500' },
                { label: 'Transit losses', value: `${totalLoss.toLocaleString()} kg`, icon: TrendingDown, color: 'text-warning-500' },
              ].map(s => (
                <div key={s.label} className="card flex items-center gap-3">
                  <s.icon className={`w-5 h-5 flex-shrink-0 ${s.color}`} />
                  <div>
                    <p className="text-xl font-bold text-gray-900">{s.value}</p>
                    <p className="text-xs text-gray-500">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Orders & Deliveries by Month</h3>
                <div className="h-52">
                  <Bar data={procurementChart} options={chartOptions('Count')} />
                </div>
              </div>
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Top Crops by Transit Loss</h3>
                <div className="space-y-3">
                  {crops.length === 0 && <p className="text-sm text-gray-400">No crop data yet.</p>}
                  {crops.map(c => {
                    const pct = Math.min(100, Math.round((c.avg_loss_pct / 8) * 100))
                    return (
                      <div key={c.crop}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">{c.crop}</span>
                          <span className="text-gray-500">{c.avg_loss_pct}% avg · {c.batch_count} batches</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: C.primary }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Breakdown</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    {['Month', 'Orders', 'Deliveries', 'Transit Loss (kg)'].map(h => (
                      <th key={h} className="pb-2 text-gray-500 font-medium text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthly.map(m => (
                    <tr key={m.month} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 font-medium text-gray-900">{m.month}</td>
                      <td className="py-2.5 text-right text-gray-700">{m.orders}</td>
                      <td className="py-2.5 text-right text-gray-700">{m.deliveries}</td>
                      <td className="py-2.5 text-right">
                        <span className={m.loss_kg > 50 ? 'text-warning-600 font-medium' : 'text-gray-500'}>{m.loss_kg} kg</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Delivery Loss Comparison ── */}
        {section === 'loss' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between print:hidden">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Delivery Method Loss Comparison</h2>
                <p className="text-sm text-gray-500 mt-0.5">Compare transit losses between self-collection and transporter delivery per market agent.</p>
              </div>
              <button onClick={downloadLossCSV} className="btn-secondary text-sm flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" /> Export CSV
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="card">
                <p className="text-xs text-gray-500 mb-1">Avg Self-Collection Loss</p>
                <p className="text-3xl font-bold text-warning-500">{avgSelfLoss}%</p>
                <p className="text-xs text-gray-400 mt-1">Across all market agents</p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-500 mb-1">Avg Transporter Loss</p>
                <p className="text-3xl font-bold text-primary-700">{avgTransLoss}%</p>
                <p className="text-xs text-gray-400 mt-1">Across all market agents</p>
              </div>
            </div>

            <div className="card bg-primary-50 border-primary-100">
              <div className="flex items-center gap-3">
                <Package className="w-6 h-6 text-primary-600" />
                <div>
                  <p className="font-semibold text-primary-800">Insight: Transporter delivery reduces loss by {(avgSelfLoss - avgTransLoss).toFixed(1)} percentage points on average.</p>
                  <p className="text-sm text-primary-600 mt-0.5">Consider recommending transporter delivery for high-volume or cold-chain batches.</p>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Loss % by Market Agent & Delivery Method</h3>
              <div className="h-64">
                <Bar data={lossChart} options={chartOptions('Transit Loss (%)', 8)} />
              </div>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Per-Agent Breakdown</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    {['Market Agent', 'Batches', 'Self-Collection Loss', 'Transporter Loss', 'Savings (ppt)'].map(h => (
                      <th key={h} className="pb-2 text-gray-500 font-medium text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lossData.map(row => (
                    <tr key={row.agent} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 font-medium text-gray-900">{row.agent}</td>
                      <td className="py-2.5 text-right text-gray-600">{row.batches}</td>
                      <td className="py-2.5 text-right">
                        <span className="text-warning-600 font-medium">{row.self_collection_pct}%</span>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="text-primary-700 font-medium">{row.transporter_pct}%</span>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="text-success-600 font-medium">+{(row.self_collection_pct - row.transporter_pct).toFixed(1)} ppt</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Batch Traceability ── */}
        {section === 'batches' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between print:hidden">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Batch Traceability</h2>
                <p className="text-sm text-gray-500 mt-0.5">Per-batch journey records including confirmed receipt and transit losses.</p>
              </div>
              <button onClick={downloadBatchesCSV} className="btn-secondary text-sm flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" /> Export CSV
              </button>
            </div>

            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-left">
                    {['Batch ID', 'Crop', 'Cooperative', 'Method', 'Dispatched', 'Received', 'Loss', 'Loss %', 'Date'].map(h => (
                      <th key={h} className="px-4 py-3 text-xs text-gray-500 font-semibold uppercase tracking-wide text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {batches.map(b => (
                    <tr key={b.batch_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{b.batch_id}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 text-right">{b.crop}</td>
                      <td className="px-4 py-3 text-gray-600 text-right">{b.cooperative}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.delivery_method === 'Transporter' ? 'bg-primary-50 text-primary-700' : 'bg-warning-50 text-warning-700'}`}>
                          {b.delivery_method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{b.dispatched_kg.toLocaleString()} kg</td>
                      <td className="px-4 py-3 text-right text-gray-700">{b.received_kg != null ? `${b.received_kg.toLocaleString()} kg` : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {b.loss_kg != null
                          ? <span className={b.loss_kg > 20 ? 'text-warning-600 font-medium' : 'text-gray-600'}>{b.loss_kg} kg</span>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {b.loss_pct != null
                          ? <span className={b.loss_pct > 3 ? 'text-danger-600 font-medium' : b.loss_pct > 1.5 ? 'text-warning-600' : 'text-success-600'}>
                              {b.loss_pct}%
                            </span>
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">{b.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
