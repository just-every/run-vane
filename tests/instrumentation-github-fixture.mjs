import assert from 'node:assert/strict'
// Only GitHub's network edge is fake. All approval, scanning, source binding, custody and PR orchestration is real.
export function githubFixture(a,{repository='just-every/run-vane',siteOrigin='http://127.0.0.1:9137'}={}) {
 const initial='a'.repeat(40),changed='b'.repeat(40),tree='c'.repeat(40),candidate='d'.repeat(40),state={head:initial,requests:[],prs:[],loseReply:false,sourceMoved:false,token:'synthetic-vane-13'}
 const source='<!doctype html><html><head><title>Fixture</title></head><body><p>synthetic-vane-source-body</p><button id="join-now">Join</button></body></html>'
 a.fixtureSites['https://api.github.com']=async request=>{
  assert.equal(request.headers.get('authorization'),'Bearer '+state.token);assert.equal(request.redirect,'manual')
  const url=new URL(request.url),path=url.pathname,body=request.method==='GET'?undefined:await request.json();state.requests.push({method:request.method,path,search:url.search,body})
  const root='/repos/'+repository
  if(path===root)return Response.json({full_name:repository,permissions:{push:true},archived:false,disabled:false})
  if(path===root+'/git/ref/heads/main')return Response.json({object:{sha:state.head}})
  if(path.startsWith(root+'/compare/'))return Response.json({total_commits:1,files:[{filename:'public/pricing.html',status:'modified',patch:'-<script src="/vane.js"></script>\n+<!-- script dropped -->'},{filename:'private/unmapped.html',status:'modified',patch:'-synthetic-vane-private-unmapped'}]})
  if(path===root+'/contents/public/pricing.html'){assert.equal(url.searchParams.get('ref'),changed);return Response.json({type:'file',encoding:'base64',size:Buffer.byteLength(source),content:Buffer.from(source).toString('base64')})}
  if(path===root+'/git/commits/'+changed)return Response.json({tree:{sha:initial}})
  if(path===root+'/git/trees'&&request.method==='POST'){assert.equal(body.base_tree,initial);assert.deepEqual(body.tree.map(f=>f.path),['public/pricing.html']);assert.ok(body.tree[0].content.includes('<script defer src="'+a.origin+'/vane.js"'));assert.ok(body.tree[0].content.includes('synthetic-vane-source-body'));assert.ok(!JSON.stringify(body).includes('private/unmapped.html'));return Response.json({sha:tree})}
  if(path===root+'/git/commits'&&request.method==='POST'){assert.deepEqual(body.parents,[changed]);assert.equal(body.tree,tree);return Response.json({sha:candidate})}
  if(path===root+'/git/refs'&&request.method==='POST'){assert.match(body.ref,/^refs\/heads\/vane\/instrumentation-[a-f0-9-]{36}$/);assert.equal(body.sha,candidate);return Response.json({ref:body.ref,object:{sha:candidate}})}
  if(path===root+'/pulls'&&request.method==='POST'){assert.equal(body.draft,true);assert.equal(body.base,'main');assert.match(body.head,/^vane\/instrumentation-/);const pr={number:17,html_url:'https://github.com/'+repository+'/pull/17',draft:true,head:{sha:candidate,ref:body.head},base:{ref:'main'},body:body.body};state.prs.push(pr);if(state.loseReply)return new Response('synthetic-vane-provider-detail',{status:502});return Response.json(pr)}
  if(path===root+'/pulls'&&request.method==='GET')return Response.json(state.prs)
  assert.fail('Unexpected GitHub fixture request '+request.method+' '+path)
 }
 return {...state,state,initial,changed,candidate,siteOrigin}
}
