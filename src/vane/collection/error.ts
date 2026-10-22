import { VaneError } from '../core'

export class IndexedCollectionError extends VaneError {
 constructor(error: VaneError, public index: number) { super(error.code, error.message, error.status) }
}
