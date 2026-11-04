// Offline benchmark: maximum tracked products and retained observations.
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {makeBackup,parseBackup,storageHealth}=require('../dist/src/upgrade');
const {dateAt}=require('../dist/src/model');
const now=new Date();
const products=Array.from({length:50},(_,i)=>({source:'npm',id:'@bench/'+String(i).padStart(3,'0')+'x'.repeat(204)}));
const history=products.flatMap(product=>Array.from({length:100},(_,i)=>{
 const time=new Date(now.getTime()-i*89*86400000/99);
 return {product,fetchedAt:time.toISOString(),metric:{kind:'npm',end:dateAt(time,-1),totals:{7:Number.MAX_SAFE_INTEGER,30:Number.MAX_SAFE_INTEGER,90:Number.MAX_SAFE_INTEGER}}};
}));
const insights={groups:Array.from({length:20},(_,i)=>({id:'g_'+i,name:'group '+i+'x'.repeat(45),keys:products.map(p=>'npm:'+p.id)})),markers:Array.from({length:200},(_,i)=>({id:'r_'+i,key:'npm:'+products[i%50].id,date:dateAt(now,-1),label:'v'+i+'x'.repeat(60),notes:'x'.repeat(500)}))};
const monitoring={rules:products.map((p,i)=>({id:'m_'+i,key:'npm:'+p.id,name:'Goal '+i,metric:'npm30',kind:'milestone',threshold:1000,enabled:true})),alerts:Array.from({length:100},(_,i)=>({id:'a_'+i,ruleId:'m_'+i%50,key:'npm:'+products[i%50].id,name:'Goal '+i,metric:'npm30',kind:'milestone',threshold:1000,value:1001,createdAt:now.toISOString(),acknowledged:false}))};
const backup=makeBackup(products,history,insights,monitoring,now),json=JSON.stringify(backup,null,2),samples=[];
for(let i=0;i<5;i++){const started=performance.now();parseBackup(json,now);samples.push(performance.now()-started);}
samples.sort((a,b)=>a-b);
const stats=storageHealth(products,backup.history,backup.insights,backup.monitoring);
const report=`# Storage benchmark\n\nGenerated ${now.toISOString()} on ${process.platform}, Node ${process.version}.\n\n- 50 npm products, each with a 214-character identifier.\n- 5,000 retained snapshots (100 per product), with large rolling totals.\n- 20 groups, 200 release markers with 500-character notes, 50 rules and 100 alerts.\n- Serialized tracking data: **${stats.bytes.toLocaleString('en-US')} bytes**.\n- Formatted backup: **${Buffer.byteLength(json).toLocaleString('en-US')} bytes** (5 MB import limit).\n- Median validation/restore preparation across five local runs: **${samples[2].toFixed(2)} ms**.\n\nThis measures JSON payload size and pure validation time. It excludes VS Code database overhead, filesystem persistence, source response caches, startup and UI rendering. Results vary by machine. History retains at most 100 observations per product within 90 days; frequent refreshes reduce effective time coverage.\n\nReproduce after compilation with \`node scripts/benchmark-storage.cjs\`. Add \`--write-report\` to update this file.\n`;
console.log(report);
if(process.argv.includes('--write-report'))fs.writeFileSync(path.join(__dirname,'..','STORAGE_BENCHMARK.md'),report);
