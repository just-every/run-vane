// Inject after the first native pageview has been accepted. Both queued and later incumbent
// calls use the same native custom-event function, privacy checks and revenue validation.
// IMPORT-009 uses this to prove recovered definitions against unchanged Plausible instrumentation.
export const incumbentCompatibility=String.raw`if(c.incumbentCompatibility){
 const previous=window.plausible, pending=[...((previous&&previous.q)||[])];
 const invoke=(name,options={})=>{const result=call(name,{...options,props:{...incumbentProperties(name),...options.props}});if(typeof options.callback==='function')Promise.resolve(result).then(()=>options.callback()).catch(()=>{});return result};
 const plausible=(name,options)=>invoke(name,options);plausible.vane=true;plausible.q=[];
 plausible.init=configureIncumbent;
 window.plausible=plausible;
 window.fathom={...(window.fathom||{}),trackEvent:(name,options={})=>invoke(name,options._value===undefined?{}:{revenue:{amount:Number(options._value)/100,currency:c.currency||'USD'}}),trackPageview:()=>invoke('pageview')};
 const classed=element=>{let name='';const props={};for(const token of element.classList){const match=token.match(/^plausible-event-([a-z0-9_-]+)(?:=|--)(.+)$/);if(match){const value=match[2].replace(/\+/g,' ');if(match[1]==='name')name=value;else props[match[1]]=value}}if(name)invoke(name,{props})};
 document.addEventListener('click',event=>{const element=event.target instanceof Element&&event.target.closest('[class*="plausible-event-name="] ,[class*="plausible-event-name--"]');if(element&&!(element instanceof HTMLFormElement))classed(element)},true);
 document.addEventListener('submit',event=>{if(event.target instanceof HTMLFormElement&&/(^|\s)plausible-event-name(?:=|--)/.test(event.target.className))classed(event.target)},true);
 for(const args of pending)await invoke(...args);
}`
