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
}
