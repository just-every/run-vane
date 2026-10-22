import type { AuthBranding } from './index.mjs';
export function pageResponse(input: {branding: Required<Pick<AuthBranding,'productName'|'accentColor'>>&AuthBranding;title?:string;heading:string;content:string;status?:number;method?:string;referrer?:string;formTargets?:string[]}):Promise<Response>;
