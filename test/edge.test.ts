import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../src/http';
import { Providers } from '../src/providers';
import { Analytics } from '../src/service';
import { dateAt, selectedPackages } from '../src/model';

test('saving discovery selection preserves unrelated products, removes unchecked candidates, and caps atomically', () => {
  const existing = [{source:'npm' as const,id:'manual'}, {source:'npm' as const,id:'react'}, {source:'openvsx' as const,id:'pub.ext'}];
  const selected = selectedPackages(existing,['react','react-dom'],['react-dom','react-dom']);
  assert.deepEqual(selected,[existing[0],existing[2],{source:'npm',id:'react-dom'}]);
  assert.deepEqual(selectedPackages(existing,['react'],[]),[existing[0],existing[2]]);
  assert.throws(()=>selectedPackages(existing,['react'],['unknown']),/outside/);
  const full = Array.from({length:50},(_,i)=>({source:'npm' as const,id:`p${i}`}));
  assert.throws(()=>selectedPackages(full,['new'],['new']),/50 products/);
  assert.equal(full.length,50); assert.equal(existing.length,3);
});

test('zero-result scope qualifier falls back to a general search with exact prefix filtering', async () => {
  let calls=0;
  const api = new Providers(new HttpClient(async url=>{
    const text = new URL(url).searchParams.get('text'); calls++;
    return new Response(JSON.stringify(text === 'scope:hello' ? {objects:[],total:0} : {objects:[{package:{name:'@hello/world'}},{package:{name:'@hello-other/world'}},{package:{name:'hello-world'}}],total:3}));
  }));
  const result = await api.discover('@hello',true);
  assert.equal(calls,2); assert.deepEqual(result.packages.map(p=>p.name),['@hello/world']); assert.match(result.note,/general search/);
});
test('npm cache refreshes at UTC midnight even inside the ten-minute TTL', async () => {
  let now=new Date('2026-03-01T23:59:00Z'),calls=0;
  const api = new Providers(new HttpClient(async()=>{ calls++; return new Response(JSON.stringify({package:'react',downloads:Array.from({length:180},(_,i)=>({day:dateAt(now,i-180),downloads:1}))})); }));
  const service=new Analytics(api,()=>now);
  await service.read({source:'npm',id:'react'});
  now=new Date('2026-03-02T00:01:00Z');
  const reading=await service.read({source:'npm',id:'react'});
  assert.equal(calls,2); assert.equal(reading.metric?.kind==='npm' && reading.metric.end,'2026-03-01');
});
test('Reddit token clear invalidates cached counts without disturbing npm', async () => {
  let calls=0;
  const api=new Providers(new HttpClient(async()=>{calls++;return new Response(JSON.stringify({data:{children:[{data:{id:'abc123',num_comments:5,title:'A post'}}]}}));}));
  const service=new Analytics(api); const p={source:'reddit' as const,id:'abc123'};
  await service.read(p,'secret','test/1 u/user'); await service.read(p,'secret','test/1 u/user'); assert.equal(calls,1);
  service.clearReddit(); const reading=await service.read(p,undefined,'test/1 u/user'); assert.equal(reading.metric,undefined); assert.match(reading.error!,/approved/);
});
