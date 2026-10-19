import type { Env } from './core'
// RETENTION-002 with COLLECT-004: the store's published capacity is D1's database size limit, 10 GB (10,240 MB) on
// Workers Paid; an owner on Workers Free sets VANE_STORE_LIMIT_MB to 500. The size is the one D1 reports after a
// read. From 80% of the capacity every app page warns; nothing is dropped or rolled up to make room.
export const STORE_LIMIT_MB=10240
export const STORE_WARN_SHARE=0.8
export async function storeUse(env:Env) {
 const bytes=Number((await env.DB.prepare('SELECT 1').run()).meta.size_after),limit=Number(env.VANE_STORE_LIMIT_MB??STORE_LIMIT_MB)*1048576
 return {bytes,limit,share:Math.round(bytes/limit*1000)/10,warn:bytes>=limit*STORE_WARN_SHARE}
}
export type StoreUse=Awaited<ReturnType<typeof storeUse>>
