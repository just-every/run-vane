import type { Field } from '../../inventory'

export function visitInventory(): Field[] {
 const fields: [string, string[], string][] = [
  ['facts',['visit','site','day','visitor','first_raw','last_raw','started','last_at','last_signal','pages','engaged','identity','first_on_page'],'Exact derived visit endpoints, local date and existing anonymous identity, counts and last signal. Native occurrences hold their visit reference; no additional identity is collected.'],
  ['page_frequencies',['visit','context','on_page','scroll','n'],'Exact multiplicities of actual page occurrences by visit, existing event context, milliseconds on page and maximum scroll. Missing scroll uses an internal sentinel. Repeated values compress without changing any occurrence.'],
  ['duration_frequencies',['site','day','duration','n'],'Exact visit-duration multiplicities for medians and averages across dates and sites.'],
  ['days',['site','day','visits','pageviews','bounces','duration_sum'],'Exact additive visit statistics per site and local date, maintained with the visit facts.'],
  ['performance',['context','metric','value','n'],'Exact multiplicities of reported performance values by existing event context; percentile populations include every reporting page load.'],
  ['measured',['context','n'],'Number of page loads with at least one measured performance figure per existing event context.'],
  ['dirty',['site','day','visitor'],'Existing anonymous chains invalidated by a sequence rewrite, deletion or dated definition change. A transaction rebuilds them before any materialized reader returns.'],
  ['legacy',['site','day','visitor'],'Existing anonymous chains containing historically accepted noncanonical event IDs. They use their original logical ordering during exact reconstruction.'],
  ['work',['raw_id','action','prev','next','left_visit','right_visit','visit','old_on_page','gap','old_engaged','old_scroll','new_engaged','new_scroll'],'Transaction-local mutation scratch carrying existing anonymous event references and timing/scroll values. Cleared before the transaction returns.'],
  ['rebuild',['site','day','visitor'],'Transaction-local request to rebuild one invalidated anonymous chain. Cleared before the transaction returns.'],
  ['rebuild_pages',['raw_id','context','run','at','id','engaged_at','scroll','identity','on_page','first','last'],'Transaction-local existing anonymous page values used for exact sequence reconstruction. Cleared before the transaction returns.'],
 ]
 return fields.map(([name,columns,description]) => ({name:'Native visit '+name.replaceAll('_',' '),table:'vane_visit_'+name,columns,description:description+' Derived tables are excluded from archives; retention and erasure remove their supporting history.'}))
}
