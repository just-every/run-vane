// Each consented person once per site; the unconsented part remains a sum of daily uniques.
export const visitorKey=(prefix='')=>`CASE WHEN ${prefix}consented_visitor IS NOT NULL THEN ${prefix}site_id||' c '||${prefix}consented_visitor ELSE ${prefix}site_id||' d '||${prefix}day||' '||${prefix}visitor END`
