export interface ViewData {
  proxyConnections?:import('../proxy/types').ProxyConnection[]
  proxyCredential?:string
  proxySetup?:ReturnType<typeof import('../proxy/templates').generateProxySetup>
  proxyPlatform?:string

  cutoverScans?:import('../cutover/scan').Scan[]
  actor: { id: string; role: string; displayName: string; access?: string; sites?: string[] | null }
  apiKeys?: (import('../api-keys').ApiKey & { creator: string; today: number | null })[]
  apiToken?: string
  pushKey?: string
  pushSubscriptions?: import('../push').PushSubscription[]
  people?: { id: string; email: string; name: string; status: string; access: string; sites: string[] | null }[]
  origin: string
  sites: any[]
  site?: any
  searchConsole?:any
  chatAuthorize?:string
  chat?: {connections:Omit<import('../chat/connections').Connection,'sealed_secret'|'created_by'>[];schedules:import('../chat/delivery').Schedule[];log:any[]}
  bing?:any
  googleKeywordPage?:string|null
  bingKeywordPage?:string|null
  report?: any
  live?: any
  /** DASH-001: the selected site's current visitors, for the rail. */
  liveVisitors?: number
  hook?: { created_at: number } | null
  github?: { created_at: number } | null
  webhooks?: import('../webhooks').Webhook[]
  webhookLog?: { delivery_id: string; attempt: number; at: number; status: number | null; outcome: string; event: string; state: string; url: string }[]
  webhookSecret?: string
  reportSubscriptions?: import('../email-reports').Subscription[]
  reportSends?: Awaited<ReturnType<typeof import('../email-reports').reportSends>>
  mailEvents?: boolean
  alerts?: import('../traffic-alerts').Alert[]
  maintenance?: import('../alert-baseline').Window[]
  followItems?: Awaited<ReturnType<typeof import('../follow-up').followItems>>
  followHistory?: Awaited<ReturnType<typeof import('../follow-up').followHistory>>
  followPolicy?: import('../follow-up').Policy
  closedDays?: { day: string; label: string }[]
  alertPeople?: { id: string; email: string; name: string }[]
  alertLog?: Awaited<ReturnType<typeof import('../traffic-alerts').alertLog>>
  health?: import('../tracking-health').Health
  mailStops?: { email: string; status: string; occurred_at: number }[]
  warehouse?: { endpoint: string; bucket: string; region: string; prefix: string; accessKeyId: string; lastDay: string; lastResult: string | null; createdAt: number } | null
  secret?: string
  shares?: import('../share').ShareLink[]
  sharePath?: string
  segments?: { id: string; name: string; filters: { dimension: string; op: string; value: string }[] }[]
  proposals?: any[]
  /** DASH-005: the site's approved US metro-name table and the codes seen without a name. */
  metroTable?: import('../metro-names').MetroTable & { unnamedSeen: string[] }
  imports?: any[]
  notice?: string
  error?: string
  importDefinitions?:import('../movein/plausible-types').RecoveredDefinition[]
  parallelReport?:import('../movein/parallel').ParallelReport
  importPreview?: any
  eventPreview?: any
  importCarry?: string
  section?: string
  audit?: any[]
  overview?: { period: string; sort: string; q: string; rows: { site: any; from: string; to: string; visitors: number; previous: number; sparkline: number[]; marks?: number[] }[] }
  rollups?: { id: string; name: string; sites: any[] }[]
  rollup?: { id: string; name: string; sites: any[] }
  store?: { bytes: number; limit: number; share: number; warn: boolean }
}
