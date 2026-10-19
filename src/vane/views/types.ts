export interface ViewData {
  actor: { id: string; role: string; displayName: string; access?: string; sites?: string[] | null }
  people?: { id: string; email: string; name: string; status: string; access: string; sites: string[] | null }[]
  origin: string
  sites: any[]
  site?: any
  report?: any
  live?: any
  hook?: { created_at: number } | null
  github?: { created_at: number } | null
  secret?: string
  shares?: import('../share').ShareLink[]
  sharePath?: string
  segments?: { id: string; name: string; filters: { dimension: string; op: string; value: string }[] }[]
  proposals?: any[]
  imports?: any[]
  notice?: string
  error?: string
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
