// Read a JavaScript literal without eval. Expressions/functions are deliberately
// incomplete: a rewrite draft must never execute page code on the server.
export function literal(source:string):{value:any;end:number}|null {
 let i=0;
 const space=()=>{while(/\s/.test(source[i]??'')&&i<source.length)i++};
 function read():any {
  space();const c=source[i];
  if(c==='"'||c==="'") {i++;let value='';while(i<source.length){const next=source[i++]!;if(next===c)return value;if(next==='\\'){const escaped=source[i++]!;if(escaped==='u'){const hex=source.slice(i,i+4);if(!/^[0-9a-f]{4}$/i.test(hex))throw Error();value+=String.fromCharCode(parseInt(hex,16));i+=4}else value+=({n:'\n',r:'\r',t:'\t'} as Record<string,string>)[escaped]??escaped}else value+=next}throw Error()}
  if(c==='{'){i++;const value:Record<string,any>=Object.create(null);space();while(source[i]!=='}'){space();const key=source[i]==='"'||source[i]==="'"?read():source.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0];if(typeof key!=='string')throw Error();if(source[i]!=="'"&&source[i]!=='"'&&source.slice(i,i+key.length)===key)i+=key.length;space();if(source[i++]!==':')throw Error();value[key]=read();space();if(source[i]!==',')break;i++;space()}if(source[i++]!=='}')throw Error();return value}
  if(c==='['){i++;const value:any[]=[];space();while(source[i]!==']'){value.push(read());space();if(source[i]!==',')break;i++}if(source[i++]!==']')throw Error();return value}
  const token=source.slice(i).match(/^(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)\b/i)?.[0];if(!token)throw Error();i+=token.length;return JSON.parse(token);
 }
 try{const value=read();return {value,end:i}}catch{return null}
}
