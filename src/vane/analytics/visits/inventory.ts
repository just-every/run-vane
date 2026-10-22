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
  ['work',['raw_id','action','prev','next','left_visit','right_visit','visit','old_on_page','gap','old_engaged','old_scroll','new_engaged','new_scroll','site','context','day','visitor','site_id','at','at_offset','token','identity','prev_at','prev_context','prev_engaged','prev_scroll','prev_visit','next_at','next_visit'],'Transaction-local mutation scratch carrying existing anonymous event references, exact raw and neighbor context, and timing/scroll values. Cleared before the transaction returns.'],
  ['rebuild',['site','day','visitor'],'Transaction-local request to rebuild one invalidated anonymous chain. Cleared before the transaction returns.'],
  ['rebuild_pages',['raw_id','context','run','at','id','engaged_at','scroll','identity','on_page','first','last'],'Transaction-local existing anonymous page values used for exact sequence reconstruction. Cleared before the transaction returns.'],
  ['bulk_scope',['singleton'],'Transaction-local switch queuing actual admitted native page rows for exact set-based visit maintenance. Cleared before the transaction returns.'],
  ['bulk_chains',['site','day','visitor','gap'],'Transaction-local affected anonymous chains and their effective dated visit timeout. Cleared before the transaction returns.'],
  ['bulk_pages',['raw_id','site','day','visitor','context','at_offset','token','at','engaged','scroll','gap','old_visit','next_id','old_on_page','on_page'],'Transaction-local new pages and distinct old predecessors, with exact previous and final page contributions. Cleared before the transaction returns.'],
  ['bulk_nodes',['kind','node_id','site','day','visitor','started','last_at','last_signal','first_raw','last_raw','pages','engaged','identity','first_on_page','run','visit'],'Transaction-local new page points and affected existing visit intervals, assigned to their exact gap-connected components. Cleared before the transaction returns.'],
  ['bulk_groups',['site','day','visitor','run','visit','first_raw','last_raw','started','last_at','last_signal','pages','engaged','identity','first_on_page'],'Transaction-local final visit facts aggregated once per affected component. Cleared before the transaction returns.'],
 ]
 return fields.map(([name,columns,description]) => ({name:'Native visit '+name.replaceAll('_',' '),table:'vane_visit_'+name,columns,description:description+' Derived tables are excluded from archives; retention and erasure remove their supporting history.'}))
}
