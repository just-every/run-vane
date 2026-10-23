// DASH-007's matches filter, run in time linear in each value. Any viewer writes the pattern, so JavaScript's
// backtracking engine, exponential on patterns such as ^/(a+)+$, never runs it: the pattern is read with
// JavaScript's syntax (no flags) and run as a Thompson automaton, one pass over the value in which each state is
// visited at most once per character. Backreferences and lookaround have no such form and are refused, as Plausible's
// RE2 does, and so is any escape not listed below. Counted repetition is expanded, and the automaton is bounded.
export class PatternError extends Error {}
type Test=(code:number)=>boolean
type Assertion='^'|'$'|'b'|'B'
type Node={k:'set',test:Test}|{k:'assert',at:Assertion}|{k:'seq',items:Node[]}|{k:'alt',items:Node[]}|{k:'rep',node:Node,min:number,max:number}
type State={k:'set',test:Test,out:number}|{k:'assert',at:Assertion,out:number}|{k:'split',out:number,alt:number}|{k:'match'}
const MAX_STATES=1000
const refuse=():never=>{throw new PatternError('unsupported')}
const digit:Test=c=>c>=48&&c<=57
const word:Test=c=>digit(c)||c>=65&&c<=90||c>=97&&c<=122||c===95
const space:Test=c=>c>=9&&c<=13||c===32||c===0xa0||c===0x1680||c>=0x2000&&c<=0x200a||c===0x2028||c===0x2029||c===0x202f||c===0x205f||c===0x3000||c===0xfeff
const lineEnd:Test=c=>c===10||c===13||c===0x2028||c===0x2029
const not=(test:Test):Test=>c=>!test(c)
const CLASSES:Record<string,Test>={d:digit,D:not(digit),w:word,W:not(word),s:space,S:not(space)}
const CONTROLS:Record<string,number>={t:9,n:10,v:11,f:12,r:13}
const char=(code:number)=>({test:(c:number)=>c===code,code})

function parse(src:string):Node {
 let i=0
 // After a backslash: \d \w \s and their negations, \t \n \v \f \r, \0, \xHH, \uHHHH, or any other character that is
 // not a letter or digit, as itself. Outside a class \b and \B are word boundaries; inside one, \b is the backspace.
 const escape=(inClass:boolean):{test:Test,code?:number}|Assertion=>{
  const c=src[i++]??refuse()
  if(Object.hasOwn(CLASSES,c))return {test:CLASSES[c]!}
  if(c==='b'||c==='B')return !inClass?c:c==='b'?char(8):refuse()
  if(Object.hasOwn(CONTROLS,c))return char(CONTROLS[c]!)
  if(c==='0'&&!digit(src.charCodeAt(i)))return char(0)
  if(c==='x'||c==='u'){const hex=src.slice(i,i+(c==='x'?2:4));if(!(c==='x'?/^[0-9a-f]{2}$/i:/^[0-9a-f]{4}$/i).test(hex))refuse();i+=hex.length;return char(parseInt(hex,16))}
  return /[0-9A-Za-z]/.test(c)?refuse():char(c.charCodeAt(0))
 }
 const classAtom=()=>{const c=src[i++]??refuse();if(c!=='\\')return char(c.charCodeAt(0));const atom=escape(true);return typeof atom==='string'?refuse():atom}
 // [...] and [^...]: single characters, ranges and class escapes; a range with a class escape at either end is, as in
 // JavaScript, the union of both ends and the hyphen.
 const charClass=():Test=>{
  const negated=src[i]==='^',parts:Test[]=[];if(negated)i++
  while(src[i]!==']'){
   const from=classAtom()
   if(src[i]==='-'&&i+1<src.length&&src[i+1]!==']'){
    i++;const to=classAtom()
    if(from.code===undefined||to.code===undefined)parts.push(from.test,c=>c===45,to.test)
    else{const low=from.code,high=to.code;if(low>high)refuse();parts.push(c=>c>=low&&c<=high)}
   } else parts.push(from.test)
  }
  i++
  return c=>parts.some(part=>part(c))!==negated
 }
 const quantifier=():[number,number]|null=>{
  const c=src[i]
  if(c==='*'||c==='+'||c==='?'){i++;return [c==='+'?1:0,c==='?'?1:Infinity]}
  const counted=c==='{'?/^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i)):null
  if(!counted)return null
  i+=counted[0].length
  return [Number(counted[1]),counted[2]?counted[3]?Number(counted[3]):Infinity:Number(counted[1])]
 }
 const term=():Node=>{
  const c=src[i++]!
  if(c==='^'||c==='$')return {k:'assert',at:c}
  if(c==='.')return {k:'set',test:not(lineEnd)}
  if(c==='[')return {k:'set',test:charClass()}
  if(c==='\\'){const atom=escape(false);return typeof atom==='string'?{k:'assert',at:atom}:{k:'set',test:atom.test}}
  if(c==='('){
   // (...), (?:...) and (?<name>...); lookahead, lookbehind and modifier groups are refused.
   if(src[i]==='?'){const name=src[i+1]==='<'&&/[A-Za-z_$]/.test(src[i+2]??'')?src.indexOf('>',i):-1;if(src[i+1]===':')i+=2;else if(name>0)i=name+1;else refuse()}
   const inner=alternation()
   if(src[i++]!==')')refuse()
   return inner
  }
  if(c==='*'||c==='+'||c==='?'||c===')'||c==='|')refuse()
  // Any other character is itself, including { } and ] where they do not form syntax.
  return {k:'set',test:char(c.charCodeAt(0)).test}
 }
 const sequence=():Node=>{
  const items:Node[]=[]
  while(i<src.length&&src[i]!=='|'&&src[i]!==')'){
   const atom=term(),range=quantifier()
   if(!range){items.push(atom);continue}
   if(atom.k==='assert')refuse()
   if(src[i]==='?')i++
   items.push({k:'rep',node:atom,min:range[0],max:range[1]})
  }
  return {k:'seq',items}
 }
 const alternation=():Node=>{
  const items=[sequence()]
  while(src[i]==='|'){i++;items.push(sequence())}
  return items.length===1?items[0]!:{k:'alt',items}
 }
 const node=alternation()
 if(i!==src.length)refuse()
 return node
}

// Compiles the pattern, or throws PatternError for syntax this matcher refuses. Callers check JavaScript validity first.
export function linearPattern(src:string):{test:(value:string)=>boolean} {
 const states:State[]=[]
 let work=0
 const add=(state:State)=>{if(states.push(state)>MAX_STATES)refuse();return states.length-1}
 // Built back to front: each node's states lead to `next`, its continuation.
 const compile=(node:Node,next:number):number=>{
  if(++work>MAX_STATES*4)refuse()
  if(node.k==='set')return add({k:'set',test:node.test,out:next})
  if(node.k==='assert')return add({k:'assert',at:node.at,out:next})
  if(node.k==='seq')return node.items.reduceRight((out,item)=>compile(item,out),next)
  if(node.k==='alt')return node.items.map(item=>compile(item,next)).reduceRight((alt,out)=>add({k:'split',out,alt}))
  let entry=next
  if(node.max===Infinity){const loop=add({k:'split',out:next,alt:next}),body=compile(node.node,loop);states[loop]={k:'split',out:body,alt:next};entry=loop}
  else for(let n=node.min;n<node.max;n++)entry=add({k:'split',out:compile(node.node,entry),alt:next})
  for(let n=0;n<node.min;n++)entry=compile(node.node,entry)
  return entry
 }
 const start=compile(parse(src),add({k:'match'}))
 const seen=new Int32Array(states.length)
 let generation=0
 const isWord=(value:string,pos:number)=>pos>=0&&pos<value.length&&word(value.charCodeAt(pos))
 const holds=(at:Assertion,value:string,pos:number)=>at==='^'?pos===0:at==='$'?pos===value.length:(isWord(value,pos-1)!==isWord(value,pos))===(at==='b')
 // Adds every character-reading state that empty moves reach from id at pos to list; true once the match is reached.
 const reach=(list:number[],id:number,value:string,pos:number)=>{
  const stack=[id]
  while(stack.length){
   const at=stack.pop()!,state=states[at]!
   if(seen[at]===generation)continue
   seen[at]=generation
   if(state.k==='match')return true
   if(state.k==='split')stack.push(state.alt,state.out)
   else if(state.k==='assert'){if(holds(state.at,value,pos))stack.push(state.out)}
   else list.push(at)
  }
  return false
 }
 return {test(value:string){
  if(generation>2**30){seen.fill(0);generation=0}
  let current:number[]=[]
  generation++
  for(let pos=0;;pos++){
   // A match may begin at any position, alongside the threads still running.
   if(reach(current,start,value,pos))return true
   if(pos===value.length)return false
   const code=value.charCodeAt(pos),next:number[]=[]
   generation++
   for(const at of current){const state=states[at] as Extract<State,{k:'set'}>;if(state.test(code)&&reach(next,state.out,value,pos+1))return true}
   current=next
  }
 }}
}
