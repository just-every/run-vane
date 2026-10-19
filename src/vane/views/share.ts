import { escape, panel } from './html'
// SHARE-001: the password form of a password-protected shared link.
export function passwordPage(site: { name: string }, error = ''): string {
  return `<h1>${escape(site.name)}</h1>${panel('Password required', `${error ? `<p class="vane-notice" role="alert">${escape(error)}</p>` : ''}<form method="post"><label>Password<input type="password" name="password" required maxlength="200" autocomplete="current-password"></label><button>View the stats</button></form>`)}`
}
