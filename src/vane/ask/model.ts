import { aiConfig, createAiClient, AiError } from '../../modules/ai/index.mjs'
import { VaneError, type Env } from '../core'

// One attempt, 20 seconds, no retry, repair or second provider (the Base ai module's contract). The seed owns enablement
// (AI_ENABLED and the owner's per-site choice), the deadline and the budget (askLimit).
const REFUSALS:Record<string,string>={ai_disabled:'Questions need the deployment’s model provider, and it is switched off (AI_ENABLED).',ai_misconfigured:'The deployment’s model provider is not configured completely.',ai_invalid_request:'The deployment names no model (AI_MODEL).'}
export async function propose(env:Env,system:string,question:string):Promise<unknown> {
 const ai=createAiClient(aiConfig(env as unknown as Record<string,unknown>))
 let content:unknown
 try {
  const response=await ai.chat({messages:[{role:'system',content:system},{role:'user',content:question}],response_format:{type:'json_object'},temperature:0,max_tokens:800},{feature:'ask',signal:AbortSignal.timeout(20000)})
  content=((await response.json()) as any)?.choices?.[0]?.message?.content
 } catch(error) {
  if(error instanceof AiError)throw new VaneError('ask_model',REFUSALS[error.code]??`The model provider did not answer (${error.code.replaceAll('_',' ')}); nothing was run.`,error.code in REFUSALS?503:502)
  throw new VaneError('ask_model','The model provider returned something unreadable; nothing was run.',502)
 }
 try { return JSON.parse(String(content)) } catch { throw new VaneError('ask_plan','The model did not reply with a plan; nothing was run.',502) }
}
