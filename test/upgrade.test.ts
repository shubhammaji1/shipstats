import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, parseBackup, storageHealth, inspectLaunch, currentValue, currentShareCard, progressSummary } from '../src/upgrade';
import { Providers } from '../src/providers';
import { HttpClient } from '../src/http';
import { Product, Reading, dateAt, windows } from '../src/model';
import { Snapshot } from '../src/history';
import { launchReview, shareCard } from '../src/launch';
import { CollectorLease } from '../src/collector';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const now=new Date('2026-11-04T12:00:00Z'),p:Product={source:'marketplace',id:'pub.ext'},npm:Product={source:'npm',id:'react'};
const insights={groups:[],markers:[{id:'r_one',key:'marketplace:pub.ext',label:'v1',date:'2026-10-20'}]},monitoring={rules:[],alerts:[]};
const snapshot=(value:number,day:string):Snapshot=>({product:p,fetchedAt:day+'T12:00:00Z',metric:{kind:'count',value}});
test('profile leases allow one background collector and leave malformed locks untouched',async()=>{
 const directory=await fs.mkdtemp(join(tmpdir(),'shipstats-lease-')),a=new CollectorLease(directory),b=new CollectorLease(directory),file=join(directory,'shipstats-collection.lock');
 try{assert.equal(await a.acquire(),true);assert.equal(await b.acquire(),false);await a.release();assert.equal(await b.acquire(),true);await b.release();await fs.writeFile(file,'bad');assert.equal(await a.acquire(),false);assert.equal(await fs.readFile(file,'utf8'),'bad');}
 finally{await a.release();await b.release();await fs.unlink(file).catch(()=>{});await fs.rmdir(directory);}
});
test('date readiness stays separate from missing observation coverage and empty comparison cards are blocked',()=>{
 const request={markerId:'r_one',target:'all',days:7};
 const status=inspectLaunch(request,[p],[],[],insights,now);assert.equal(status.rows[0]!.beforeAvailable,false);assert.equal(status.rows[0]!.afterAvailable,false);assert.equal(status.rows[0]!.firstRecordedAt,undefined);
 const report=launchReview(request,[p],[],[],insights,now);assert.throws(()=>shareCard(report,'product:marketplace:pub.ext'),/No historical values/);
 const history=[snapshot(10,'2026-10-13'),snapshot(10,'2026-10-19'),snapshot(10,'2026-10-20'),snapshot(10,'2026-10-26')];
 const full=inspectLaunch(request,[p],[],history,insights,now);assert.equal(full.rows[0]!.beforeAvailable,true);assert.equal(full.rows[0]!.afterAvailable,true);assert.match(shareCard(launchReview(request,[p],[],history,insights,now),'product:marketplace:pub.ext'),/>0<\/text>/);
});
test('current cards require a fresh valid source value and distinguish rolling downloads from cumulative installs',()=>{
 const reading:Reading={product:p,fetchedAt:now.toISOString(),metric:{kind:'count',value:0,label:'Installs'}};
 const value=currentValue([p],[reading],'marketplace:pub.ext',30,now),svg=currentShareCard(value);assert.equal(value.value,0);assert.match(svg,/CURRENT METRIC/);assert.match(svg,/cumulative/);assert.doesNotMatch(svg,/AFTER RELEASE|BEFORE RELEASE/);
 for(const r of [{...reading,error:'offline'},{...reading,fetchedAt:dateAt(now,-1)+'T00:00:00Z'}])assert.throws(()=>currentValue([p],[r],'marketplace:pub.ext',30,now),/Refresh/);
 const daily=Array.from({length:180},(_,i)=>({day:dateAt(now,i-180),downloads:1}));const nr:Reading={product:npm,fetchedAt:now.toISOString(),metric:{kind:'npm',daily,windows:windows(daily,now),start:dateAt(now,-180),end:dateAt(now,-1)}};
 assert.equal(currentValue([npm],[nr],'npm:react',7,now).value,7);assert.match(currentValue([npm],[nr],'npm:react',7,now).label,/7 completed/);assert.throws(()=>currentValue([npm],[nr],'npm:react',10,now),/Choose/);
});
test('backups exclude unknown secret fields, validate schema and limits, and prune expired observations',()=>{
 const backup=makeBackup([p],[snapshot(12,'2026-11-01')],insights,monitoring,now);
 const restored=parseBackup(JSON.stringify({...backup,token:'secret',settings:{redditToken:'secret'}}),now);assert.equal(restored.products[0]!.id,p.id);assert.doesNotMatch(JSON.stringify(restored),/secret|redditToken/);
 for(const value of ['bad',JSON.stringify({...backup,version:2}),JSON.stringify({...backup,products:[...backup.products,...backup.products]}),JSON.stringify({...backup,history:Array(5001).fill({})})])assert.throws(()=>parseBackup(value,now));
 const old={...backup,history:[snapshot(12,'2026-01-01')]};assert.equal(parseBackup(JSON.stringify(old),now).history.length,0);
 assert.ok(storageHealth([p],backup.history,insights,monitoring).bytes>0);assert.equal(storageHealth([p],backup.history,insights,monitoring).maxSnapshots,100);
});
test('weekly progress retains actual observation spans, null changes and separate metric meanings',()=>{
 const history=[snapshot(10,'2026-10-29'),snapshot(15,'2026-11-02')];const summary=progressSummary([p],[],history,monitoring,now);assert.equal(summary.rows[0]!.difference,5);assert.equal(summary.rows[0]!.value,15);assert.match(summary.rows[0]!.coverage,/2026-10-29/);
 assert.equal(progressSummary([p],[],history.slice(1),monitoring,now).rows[0]!.difference,null);
});
test('npm release suggestions validate identity, version dates and bounds without installing packages',async()=>{
 const client=new HttpClient(async(url,init)=>{assert.equal(url,'https://registry.npmjs.org/react');assert.equal(init?.method,undefined);return new Response(JSON.stringify({name:'react',versions:{'1.0.0':{},'2.0.0-beta.1':{},'9.0.0':{}},time:{created:'2000-01-01T00:00Z','1.0.0':'2026-10-20T01:00Z','2.0.0-beta.1':'2026-11-01T01:00Z','9.0.0':'2027-01-01T00:00Z','bad':'2026-11-01T00:00Z'}}));});
 const versions=await new Providers(client).releases('react',now);assert.deepEqual(versions.map(r=>r.version),['2.0.0-beta.1','1.0.0']);assert.equal(versions[0]!.date,'2026-11-01');
});
