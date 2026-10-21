/** Prefer a source, across all of its export pages, while any contribution from
 * that source remains. Undo reveals the preceding active owner choice. */
export function preferredSourceSql(alias:string) {
 return `(SELECT choice.provider FROM vane_import_day_choices choice WHERE choice.site_id=${alias}.site_id AND choice.day=${alias}.day AND (
 EXISTS(SELECT 1 FROM vane_import_reports chosen WHERE chosen.site_id=choice.site_id AND chosen.day=choice.day AND chosen.provider=choice.provider)
 OR EXISTS(SELECT 1 FROM vane_import_sources source CROSS JOIN vane_import_events chosen ON chosen.site_id=source.site_id AND chosen.import_job=source.job_id WHERE source.site_id=choice.site_id AND source.provider=choice.provider AND chosen.day=choice.day)
 ) ORDER BY choice.precedence DESC,choice.job_id DESC LIMIT 1)`
}
export const eventProviderSql=(alias:string)=>`COALESCE((SELECT source.provider FROM vane_import_sources source WHERE source.site_id=${alias}.site_id AND source.job_id=${alias}.import_job),'umami')`
