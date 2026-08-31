import apiClient from './client.js'

export const cooperativesApi = {
  // Crops reference list
  getCrops: () => apiClient.get('/cooperatives/crops/'),

  // Cooperative profile
  getMyCooperative: () => apiClient.get('/cooperatives/my/'),
  updateCooperative: (id, data) => apiClient.patch(`/cooperatives/${id}/`, data),
  getCropPerformance: () => apiClient.get('/cooperatives/crop-performance/'),

  // Directory (for distributors) — returns ranked cooperatives
  searchDirectory: (params) => apiClient.get('/cooperatives/directory/', { params }),
  getCooperativeDetail: (id) => apiClient.get(`/cooperatives/${id}/`),

  // Transporter management (cooperative manager) — for cooperatives that own their own
  // trucks and register their own drivers, mirroring the distributor's own-fleet pattern.
  registerOwnDriver: (data) => apiClient.post('/cooperatives/register-own-driver/', data),
  getMyTransporters: (config) => apiClient.get('/cooperatives/my-transporters/', config),
  updateTransporter: (id, data) => apiClient.patch(`/cooperatives/my-transporters/${id}/`, data),
  deactivateTransporter: (id) => apiClient.delete(`/cooperatives/my-transporters/${id}/`),

  // Stock management
  getMyStock: () => apiClient.get('/cooperatives/stock/'),
  addStock: (data) => apiClient.post('/cooperatives/stock/', data),
  updateStock: (id, data) => apiClient.patch(`/cooperatives/stock/${id}/`, data),
  deleteStock: (id) => apiClient.delete(`/cooperatives/stock/${id}/`),

  // Waste reports — produce that spoiled before it was ever dispatched
  getWasteReports: () => apiClient.get('/cooperatives/waste-reports/'),
  submitWasteReport: (data) => apiClient.post('/cooperatives/waste-reports/', data),
  submitWasteReportBatch: (data) => apiClient.post('/cooperatives/waste-reports/create-batch/', data),

  // Storage facilities
  getMyFacilities: () => apiClient.get('/cooperatives/facilities/'),

  // IoT readings for storage facilities
  getStorageReadings: (params) => apiClient.get('/iot/storage/', { params }),

  // QR code generation
  generateBatchQR: (batchId) => apiClient.get(`/traceability/batches/${batchId}/qr/`),

  // Warehouse rental (renting space from an independent Warehouse Manager)
  searchWarehouses: (params) => apiClient.get('/cooperatives/warehouses/', { params }),
  getMyRentalRequests: () => apiClient.get('/cooperatives/warehouse-rentals/'),
  requestWarehouseRental: (data) => apiClient.post('/cooperatives/warehouse-rentals/', data),
  endWarehouseRental: (id) => apiClient.post(`/cooperatives/warehouse-rentals/${id}/end/`),
  rateWarehouseRental: (id, data) => apiClient.post(`/cooperatives/warehouse-rentals/${id}/rate/`, data),
}
