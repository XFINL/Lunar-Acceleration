import { request } from './client'

export type TrafficGranularity = 'hour' | 'day'
export type StatisticsPeriod = TrafficGranularity | 'week' | 'month'
export type StatisticsReportName = 'traffic' | 'bandwidth' | 'requests' | 'hitrate' | 'region' | 'isp' | 'status-code' | 'top-url' | 'top-ip'

export interface TrafficSeriesPoint { time: string; bytes: string }
export interface TrafficStatistics {
  granularity: TrafficGranularity; startTime: string; endTime: string; unit: 'bytes'; source: 'persisted_hourly'
  coverage: 'observed_only'; availability: 'available' | 'no_data'; series: TrafficSeriesPoint[]; totalBytes: string | null
}
export interface TrafficStatisticsQuery { domainId?: string; startTime?: string; endTime?: string; granularity?: TrafficGranularity }
export interface ReportQuery { domainId?: string; startTime?: string; endTime?: string; granularity?: StatisticsPeriod }
export interface MetricSeriesPoint { time: string; value: string; hit?: string; miss?: string; percent?: number }
export interface MetricReport {
  granularity: StatisticsPeriod; startTime: string; endTime: string; unit: string; series: MetricSeriesPoint[]; total: string
}
export interface BreakdownReport { items: Array<{ key: string; requests: string; bytes?: string }> }

export const statisticsApi = {
  getTraffic: (params: TrafficStatisticsQuery = {}) => request.get<TrafficStatistics>('/user/statistics/traffic', { params }),
  getReport: (report: StatisticsReportName, params: ReportQuery = {}) => request.get<MetricReport | BreakdownReport>(`/user/statistics/${report}`, { params }),
  exportCsv: (params: ReportQuery & { report: StatisticsReportName }) => request.get<Blob>('/user/statistics/export', { params, responseType: 'blob' }),
}
