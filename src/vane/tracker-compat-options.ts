// IMPORT-008: page-local Plausible options are read before automatic collection.
// Source: plausible.io/docs/script-extensions and /docs/script-update-guide.
export const incumbentOptions=String.raw`
const incumbent=c.incumbentCompatibility===true,oldPlausible=window.plausible;
let incumbentProps=null,incumbentDownloads=null,incumbentLocal=false;
const defaultDownloads=['pdf','doc','docx','xls','xlsx','ppt','pptx','csv','txt','rtf','odt','ods','zip','gz','dmg','exe','msi','apk','epub','mp3','wav','mp4','mov','avi','mkv'];
const configureIncumbent=options=>{if(!incumbent||!options)return;
 if(Object.hasOwn(options,'customProperties'))incumbentProps=options.customProperties;
 if(Object.hasOwn(options,'hashBasedRouting'))hash=s.hasAttribute('data-hash')||options.hashBasedRouting===true;
 if(Object.hasOwn(options,'autoCapturePageviews'))manual=s.hasAttribute('data-manual')||options.autoCapturePageviews===false;
 if(Object.hasOwn(options,'captureOnLocalhost'))incumbentLocal=options.captureOnLocalhost===true;
 for(const [option,kind] of [['fileDownloads','download'],['outboundLinks','outbound'],['formSubmissions','form']])if(Object.hasOwn(options,option)){
  const index=auto.indexOf(kind);if(options[option]!==false&&index<0)auto.push(kind);else if(options[option]===false&&index>=0)auto.splice(index,1);
 }
 if(options.fileDownloads&&Array.isArray(options.fileDownloads.fileExtensions))incumbentDownloads=options.fileDownloads.fileExtensions.map(x=>String(x).replace(/^\./,'').toLowerCase());
};
if(incumbent){
 const legacy={};for(const script of [s,...document.querySelectorAll('script[src]')]){let path;try{path=new URL(script.src).pathname}catch{continue}if(script!==s&&!/plausible/i.test(script.src))continue;
  for(const [extension,option] of [['hash','hashBasedRouting'],['outbound-links','outboundLinks'],['file-downloads','fileDownloads']])if(path.split('.').includes(extension))legacy[option]=true;
  if(path.split('.').includes('manual'))legacy.autoCapturePageviews=false;
 }
 configureIncumbent(legacy);configureIncumbent(oldPlausible&&oldPlausible.o);
}
const incumbentProperties=name=>{if(!incumbent)return {};try{const value=typeof incumbentProps==='function'?incumbentProps(name):incumbentProps;return value&&typeof value==='object'?value:{}}catch{return {}}};
const incumbentAllowed=()=>!incumbent||incumbentLocal||!['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const isDownload=url=>{const extension=url.pathname.split('/').pop().split('.').pop().toLowerCase();return (incumbentDownloads||defaultDownloads).includes(extension)};
`
