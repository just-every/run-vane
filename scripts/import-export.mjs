#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { preview } from './history-import/preview.mjs';
import { apply } from './history-import/apply.mjs';
import { ImportError, requireValue, originOf } from './history-import/common.mjs';

// Cookie files contain the session Cookie header value, without the header name.
// Preview: --origin URL --site ID --format umami|simple|posthog --input FILE --cookie-file FILE --review-dir DIR
// Apply: --review-dir DIR --cookie-file FILE --yes
export async function main(args = process.argv.slice(2)) {
  const [command, ...flags] = args;
  requireValue(['preview', 'apply'].includes(command), 'COMMAND_REQUIRED');
  const allowed = command === 'preview' ? ['origin', 'site', 'format', 'input', 'cookie-file', 'review-dir'] :
    ['review-dir', 'cookie-file', 'yes'];
  const options = {};
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    requireValue(flag.startsWith('--') && allowed.includes(flag.slice(2)), 'UNKNOWN_ARGUMENT');
    const key = flag.slice(2);
    requireValue(!Object.hasOwn(options, key), 'DUPLICATE_ARGUMENT');
    if (key === 'yes') options.yes = true;
    else {
      const value = flags[++index];
      requireValue(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'ARGUMENT_VALUE_REQUIRED');
      options[key] = value;
    }
  }
  requireValue(allowed.every(key => key === 'yes' || Object.hasOwn(options, key)), 'MISSING_ARGUMENT');
  if (command === 'preview') {
    options.origin = originOf(options.origin);
    requireValue(['umami', 'simple', 'posthog'].includes(options.format), 'INVALID_FORMAT');
    await preview(options);
  } else await apply(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Filesystem errors and unexpected failures may include private paths or
    // request details. Print only fixed diagnostics and leave checkpoints intact.
    const code = error instanceof ImportError ? error.code : 'LOCAL_IO_OR_RUNTIME_FAILURE';
    process.stderr.write(`IMPORT_ERROR ${code}\n`);
    process.exitCode = 1;
  });
}
