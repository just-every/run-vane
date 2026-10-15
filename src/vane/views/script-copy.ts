import { escape } from './html'

/** Only this static script receives the document nonce; snippets remain escaped text. */
export const scriptCopy = `document.querySelectorAll('[data-copy-script]').forEach(button => {
  button.addEventListener('click', async () => {
    const block = button.closest('.vane-script');
    const code = block.querySelector('code');
    const status = block.querySelector('[role="status"]');
    try {
      await navigator.clipboard.writeText(code.textContent);
      status.textContent = 'Copied';
    } catch {
      status.textContent = 'Could not copy the script.';
    }
  });
});`

export function copyableScript(snippet: string): string {
  return `<div class="vane-script"><pre class="vane-code"><code>${escape(snippet)}</code></pre><button type="button" class="vane-copy vane-secondary" data-copy-script aria-label="Copy script"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/></svg></button><span class="vane-copy-status" role="status" aria-live="polite"></span></div>`
}
