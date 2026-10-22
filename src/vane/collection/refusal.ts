import { type Env, type Site, VaneError } from '../core'
import { countExclusion } from '../exclusions'
import { localDay } from '../visitors'
import { clock } from '../clock'
import { CollectionRefusal } from './validation'

export async function countCollectionRefusal(env: Env, value: Site, error: VaneError) {
 const today = localDay(clock(), value.config.timeZone ?? 'UTC')
 if (error instanceof CollectionRefusal) await countExclusion(env, value.id, today, error.reason).run()
 else if (error.status === 400 || error.status === 413 || ['origin','conflict','admission'].includes(error.code)) await countExclusion(env, value.id, today, 'collection-error').run()
}
