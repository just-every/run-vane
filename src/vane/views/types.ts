export interface ViewData {
  actor: { id: string; role: string; displayName: string }
  origin: string
  sites: any[]
  site?: any
  report?: any
  proposals?: any[]
  imports?: any[]
  notice?: string
  error?: string
  importPreview?: any
  importCarry?: string
  section?: string
  audit?: any[]
  overview?: { period: string; sort: string; q: string; rows: { site: any; from: string; to: string; visitors: number; previous: number; sparkline: number[] }[] }
  rollups?: { id: string; name: string; sites: any[] }[]
  rollup?: { id: string; name: string; sites: any[] }
  store?: { bytes: number; limit: number; share: number; warn: boolean }
}
