import { RerError } from '@runeditrun/rer/internal/cli/errors.mjs';
import { localPortability } from '@runeditrun/rer/portability';
import { installationPolicy } from './portability-policy.mjs';
import { remoteImport } from './remote-import.mjs';

export function installationPortability() {
 const local = localPortability({ database: 'foundation', policy: installationPolicy, transient: ['local runtime caches and logs'] });
 return {
  ...local, remote: true,
  export(context) {
   if (context.target === 'remote') throw new RerError('safety_refusal', 'Hosted export is not supported. Export the stopped local installation before moving it.', 4);
   return local.export(context);
  },
  import: context => context.target === 'remote' ? remoteImport(context) : local.import(context),
 };
}
