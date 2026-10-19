import { request } from './client'

export type TrafficGranularity = 'hour' | 'day'

export interface TrafficSeriesPoint {
  time: string
  bytes: string
}

export interface TrafficStatistics {
  granularity: TrafficGranularity
  startTime: string
  endTime: string
  unit: 'bytes'
  source: 'persisted_hourly'
  coverage: 'observed_only'
  availability: 'available' | 'no_data'
  series: TrafficSeriesPoint[]
  totalBytes: string | null
}

export interface TrafficStatisticsQuery {
  domainId?: string
  startTime?: string
  endTime?: string
  granularity?: TrafficGranularity
}

export const statisticsApi = {
  // Sends only supplied filters; omitted times use the server's last 24 complete UTC hours.
  // 送信するのは指定済みの絞り込み条件のみ。時刻未指定時はサーバー側の直近24個の完全なUTC時間を使います。
  getTraffic: (params: TrafficStatisticsQuery = {}) =>
    request.get<TrafficStatistics>('/user/statistics/traffic', { params }),
}
