import { useState, useEffect } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { Eye, Download, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { analyticsApi, triggerDownload } from '../../api/analytics.js'
import { cooperativesApi } from '../../api/cooperatives.js'
import { RWANDA_DISTRICTS } from '../../components/ui/DistrictPicker.jsx'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toLocaleString()} kg` } } },
  scales: {
    y: {
      min: 0,
      grid: { color: '#f1f5f9' },
      ticks: { font: { size: 11 } },
      title: { display: true, text: 'Volume (kg)', font: { size: 11 }, color: '#6b7280' },
    },
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
  },
}

function PillGroup({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
            value === opt
              ? 'bg-primary-800 text-white border-primary-800'
              : 'bg-white text-gray-700 border-gray-200 hover:border-primary-400 hover:text-primary-700'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export default function CustomReportsPage() {
  const [crops, setCrops] = useState(['All'])
  const [crop, setCrop] = useState('All')
  const [district, setDistrict] = useState('All')
  const [startDate, setStart] = useState('')
  const [endDate, setEnd] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    cooperativesApi.getCrops()
      .then(res => setCrops(['All', ...(res.data?.results ?? res.data ?? []).map(c => c.name)]))
      .catch(() => {})
  }, [])

  const districts = ['All', ...RWANDA_DISTRICTS]

  const preview = async () => {
    setLoading(true)
    try {
      const params = { crop, district }
      if (startDate) params.date_from = startDate
      if (endDate) params.date_to = endDate
      const res = await analyticsApi.getMinagriCustomReportPreview(params)
      setResult(res.data)
      if ((res.data.summary || []).length === 0) toast('No batches match these filters', { icon: 'ℹ️' })
    } catch {
      toast.error('Could not load report preview')
    } finally {
      setLoading(false)
    }
  }

  const exportReport = async (fileFormat) => {
    setExporting(fileFormat)
    try {
      const params = { report_type: 'crops', file_format: fileFormat, crop, district }
      if (startDate) params.date_from = startDate
      if (endDate) params.date_to = endDate
      const res = await analyticsApi.exportReport(params)
      triggerDownload(res, `crop_loss_report.${fileFormat}`)
      toast.success(`Exported ${fileFormat.toUpperCase()}`)
    } catch {
      toast.error('Could not export report')
    } finally {
      setExporting(null)
    }
  }

  const barData = result ? {
    labels: result.chart.categories,
    datasets: [{
      label: 'Volume (kg)',
      data: result.chart.volume_kg,
      backgroundColor: '#2d6a4f',
      borderRadius: 4,
    }],
  } : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Custom Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Build and export a crop loss report filtered by crop, district, and date range</p>
      </div>

      {/* Report Builder */}
      <div className="card space-y-6">
        <h2 className="font-semibold text-gray-900">Custom Report Builder</h2>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Crop</p>
          <PillGroup options={crops} value={crop} onChange={setCrop} />
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">District</p>
          <PillGroup options={districts} value={district} onChange={setDistrict} />
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-3">Time Period (optional — leave blank for all time)</p>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="label">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStart(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">End Date</label>
              <input type="date" value={endDate} onChange={e => setEnd(e.target.value)} className="input" min={startDate || undefined} />
            </div>
          </div>
        </div>

        <button
          onClick={preview}
          disabled={loading}
          className="btn-primary w-full flex items-center justify-center gap-2 py-3 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          Preview Report
        </button>
      </div>

      {/* Report Preview */}
      {result && (
        <div className="card space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Report Preview</h2>
            <div className="flex gap-2">
              <button
                onClick={() => exportReport('pdf')}
                disabled={exporting !== null}
                className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60"
              >
                {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export PDF
              </button>
              <button
                onClick={() => exportReport('csv')}
                disabled={exporting !== null}
                className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-60"
              >
                {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export CSV
              </button>
            </div>
          </div>

          <p className="text-sm text-gray-600 font-medium">
            Volume &amp; Loss by Crop {crop !== 'All' && `— ${crop}`} {district !== 'All' && `— ${district}`}
            {(startDate || endDate) && ` (${startDate || '…'} to ${endDate || '…'})`}
          </p>

          {result.summary.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No batches match these filters.</p>
          ) : (
            <>
              <div className="h-52">
                <Bar data={barData} options={barOptions} />
              </div>

              <div>
                <h3 className="font-semibold text-gray-800 mb-3">Summary Statistics</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Crop', 'Batches', 'Volume (kg)', 'Avg Transit Loss %', 'Avg Total Loss %'].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide pb-3 pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.summary.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="py-3 pr-4 text-sm font-medium text-primary-700">{r.crop}</td>
                        <td className="py-3 pr-4 text-sm text-gray-700">{r.batches}</td>
                        <td className="py-3 pr-4 text-sm text-gray-700">{r.volume_kg.toLocaleString()}</td>
                        <td className="py-3 pr-4 text-sm text-gray-700">{r.avg_transit_loss_pct}%</td>
                        <td className="py-3 text-sm text-primary-700">{r.avg_total_loss_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
