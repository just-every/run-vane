// API-002: every table of a report as CSV, read from the same report the dashboard renders, so each file has the
// dashboard's figures for the same site, range, comparison, filters and segment. A table is any list of rows in the
// report (breakdowns, pages, goals, the chart's series, annotations); its columns are the rows' plain fields.
export function csvTables(report:Record<string,unknown>):string[] {
 return Object.entries(report).filter(([key,value])=>key!=='importedReports'&&Array.isArray(value)&&value.length>0&&value.every(row=>row!==null&&typeof row==='object'&&!Array.isArray(row))).map(([key])=>key)
}
export const tableTitle=(key:string)=>key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase())
// RFC 4180 quoting; a text cell starting with =, +, - or @ gets a leading apostrophe so a spreadsheet never runs it.
const cell=(value:unknown)=>{if(value===null||value===undefined)return '';const text=typeof value==='string'&&/^[=+\-@]/.test(value)?`'${value}`:String(value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text}
export function toCsv(rows:Record<string,unknown>[]):string {
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row).filter(key=>row[key]===null||['string','number','boolean'].includes(typeof row[key]))))]
 return [columns.join(','),...rows.map(row=>columns.map(column=>cell(row[column])).join(','))].join('\r\n')+'\r\n'
}
