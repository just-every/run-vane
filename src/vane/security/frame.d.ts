// The copied Base frame is JavaScript; keep its seed-side declaration outside copied layers.
declare module '*modules/operator-auth/page.mjs' {
 export function pageResponse(input:{branding:{productName:string;accentColor:string;theme?:string};title?:string;heading:string;content:string;status?:number;method?:string;referrer?:string;formTargets?:string[]}):Promise<Response>;
}
