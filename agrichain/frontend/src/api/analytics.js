import apiClient from './client.js'

export const analyticsApi = {
  // National KPIs — snapshot tables (nightly job)
  getNationalKPIs: (params) => apiClient.get('/analytics/national/', { params }),
  getDistrictKPIs: (params) => apiClient.get('/analytics/districts/', { params }),

  // MINAGRI live-compute endpoints
  getMinagriExecutive:   ()       => apiClient.get('/analytics/minagri/executive/'),
  getMinagriDistricts:   ()       => apiClient.get('/analytics/minagri/districts/'),
  getMinagriRankings:    ()       => apiClient.get('/analytics/minagri/rankings/'),
  getMinagriLossTrend:   (params) => apiClient.get('/analytics/minagri/loss-trend/', { params }),
  getMinagriBottlenecks: ()       => apiClient.get('/analytics/minagri/bottlenecks/'),
  getMinagriCustomReportPreview: (params) => apiClient.get('/analytics/minagri/custom-report-preview/', { params }),
  getMinagriAlerts:      ()       => apiClient.get('/analytics/minagri/notifications/'),
  minagriChat:           (q)      => apiClient.post('/analytics/minagri/chat/', { question: q }),

  // Distribution analytics (live)
  getDistributionAnalytics: ()    => apiClient.get('/analytics/distribution/'),

  // AI Insights
  getDailyBrief: ()               => apiClient.get('/ai-insights/daily-brief/latest/'),
  getInsights:   (params)         => apiClient.get('/ai-insights/insights/', { params }),

  // Reports
  getReports:    (params)         => apiClient.get('/reports/', { params }),
  requestReport: (data)           => apiClient.post('/reports/generate/', data),
  downloadReport:(id)             => apiClient.get(`/reports/${id}/download/`, { responseType: 'blob' }),

  // CSV/PDF export (role-aware, immediate download)
  // params: { report_type: 'batches' | 'stock' | 'jobs' | ..., file_format: 'csv' | 'pdf' }
  exportReport: (params)          => apiClient.get('/reports/export/', { params, responseType: 'blob' }),

  // Loss prediction
  getPredictions: (params)        => apiClient.get('/predictions/', { params }),
  getHighRiskPredictions: ()      => apiClient.get('/predictions/high_risk/'),

  // Notifications
  getNotifications: (params)      => apiClient.get('/notifications/', { params }),
  markRead:    (id)               => apiClient.post(`/notifications/${id}/read/`),
  markAllRead: ()                 => apiClient.post('/notifications/mark-all-read/', {}, { _silent: true }),

  // System Announcements (Admin) — posting/reactivating one notifies every user
  getAnnouncements:    (params)      => apiClient.get('/notifications/announcements/', { params }),
  createAnnouncement:  (data)        => apiClient.post('/notifications/announcements/', data),
  updateAnnouncement:  (id, data)    => apiClient.patch(`/notifications/announcements/${id}/`, data),
  deleteAnnouncement:  (id)          => apiClient.delete(`/notifications/announcements/${id}/`),
}

/**
 * Triggers a browser download from a blob response.
 * Usage: triggerDownload(response, 'my_report.csv')
 */
export function triggerDownload(blobResponse, filename = 'report.csv') {
  const url = URL.createObjectURL(new Blob([blobResponse.data]))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(url)
  document.body.removeChild(a)
}
