import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cardPng } from './png-fixture';
const { JSDOM } = require('jsdom');
const script = readFileSync(join(__dirname,'../../media/dashboard.js'),'utf8');
function setup(saved = {}) {
  const messages: any[] = []; let uiState: unknown;
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', { runScripts:'outside-only', url:'https://webview.local' });
  dom.window.acquireVsCodeApi = () => ({postMessage:(m: unknown)=>messages.push(m),getState:()=>saved,setState:(s: unknown)=>{uiState=s;}});
  dom.window.eval(script);
  const update = (data: object) => dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'state',products:[],readings:[],busy:false,...data}}));
  const click = (text: string) => { const b = [...dom.window.document.querySelectorAll('button')].find((b:any)=>b.textContent===text) as any; assert.ok(b,`Button ${text}`); b.click(); };
  return {dom,messages,update,click,get uiState(){return uiState;},document:dom.window.document};
}
test('webview discovers, filters, selects, saves and keeps manual products out of discovery selection', () => {
  const ui = setup(); assert.equal(ui.messages[0].type,'ready');
  ui.update({products:[{source:'npm',id:'manual'}],discovery:{packages:[{name:'react',description:'UI'},{name:'react-dom',description:'DOM'}],note:'Public search'}});
  const identity = ui.document.querySelector('#identity'); identity.value='owner';
  ui.document.querySelector('form').dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true}));
  assert.equal(ui.messages.at(-1).identity,'owner');
  const filter = ui.document.querySelector('[aria-label="Filter discovered packages"]'); filter.value='react-dom'; filter.dispatchEvent(new ui.dom.window.Event('input'));
  assert.equal(ui.document.querySelectorAll('.package-option').length,1);
  ui.click('Select visible'); ui.click('Track selected packages');
  assert.equal(JSON.stringify(ui.messages.at(-1)),JSON.stringify({type:'select',names:['react-dom']}));
  ui.dom.window.close();
});
test('webview renders real zero, partial aggregate, errors and text safely, and switches periods', () => {
  const ui = setup(); const p={source:'npm',id:'react'};
  ui.update({products:[p,{source:'npm',id:'unavailable'}],readings:[{product:p,metric:{kind:'npm',daily:[],windows:[{days:7,total:0,previous:0,change:null},{days:30,total:30,previous:15,change:100},{days:90,total:null,previous:null,change:null}],end:'2026-02-27'},fetchedAt:'2026-02-28T00:00Z'},{product:{source:'npm',id:'unavailable'},error:'<img src=x onerror=alert(1)>'}]});
  assert.match(ui.document.querySelector('.summary').textContent,/Total is partial/);
  assert.equal(ui.document.querySelectorAll('img').length,0); assert.match(ui.document.querySelector('.error').textContent,/<img/);
  ui.click('7 days'); assert.equal(ui.document.querySelector('.metric').textContent,'0'); assert.match(ui.document.body.textContent,/preceding period was zero/);
  ui.click('90 days'); assert.equal(ui.document.querySelector('.metric').textContent,'Unavailable');
  assert.equal((ui.uiState as any).period,90);
  ui.click('View source ↗'); assert.equal(ui.messages.at(-1).key,'npm:react');
  ui.dom.window.close();
});
test('stale npm readings excluded from totals, busy controls disabled, and cumulative metrics stay separate', () => {
  const ui = setup(); const npm={source:'npm',id:'react'}, vsx={source:'openvsx',id:'a.b'};
  ui.update({busy:true,products:[npm,vsx],readings:[{product:npm,stale:true,error:'offline',metric:{kind:'npm',daily:[],windows:[{days:30,total:3,previous:2,change:50}],end:'2026-02-27'}},{product:vsx,metric:{kind:'count',value:50,label:'Open VSX downloads · cumulative'}}]});
  assert.match(ui.document.querySelector('.summary').textContent,/0 of 1 npm packages/);
  assert.equal(ui.document.querySelector('.summary-total').textContent,'—');
  assert.ok(ui.document.querySelector('.primary').disabled); assert.match(ui.document.body.textContent,/No historical trend/);
  ui.dom.window.close();
});

test('navigation separates onboarding from overview and preserves package choices between pages', () => {
  const ui = setup();
  ui.update({products:[],discoveryKey:'username:alice',identity:'alice',discovery:{packages:[{name:'one',description:'First package'}],note:'Public search'}});
  assert.equal(ui.document.querySelector('#view-packages').hidden,false);
  const checkbox=ui.document.querySelector('[type="checkbox"]'); checkbox.checked=true; checkbox.dispatchEvent(new ui.dom.window.Event('change'));
  ui.document.querySelector('[aria-controls="view-overview"]').click();
  assert.equal(ui.document.querySelector('#view-packages').hidden,true);
  assert.equal(ui.document.querySelector('[aria-controls="view-overview"]').getAttribute('aria-current'),'page');
  ui.document.querySelector('[aria-controls="view-integrations"]').click();
  assert.equal(ui.document.querySelector('#view-integrations').hidden,false);
  ui.document.querySelector('[aria-controls="view-packages"]').click();
  assert.equal(ui.document.querySelector('[type="checkbox"]').checked,true);
  assert.equal((ui.uiState as any).page,'packages'); ui.dom.window.close();
});

test('product source and text filters change visible cards without changing overview totals', () => {
  const ui=setup(); const a={source:'npm',id:'alpha'}, b={source:'openvsx',id:'pub.beta'};
  ui.update({products:[a,b],readings:[{product:a,metric:{kind:'npm',windows:[{days:30,total:7,previous:5,change:40}],daily:[],end:'2026-10-29'}},{product:b,metric:{kind:'count',value:123,label:'Cumulative downloads'}}]});
  assert.equal(ui.document.querySelector('#view-overview').hidden,false);
  ui.click('Open VSX');
  assert.equal(ui.document.querySelectorAll('.product').length,1); assert.match(ui.document.querySelector('.cards').textContent,/pub.beta/);
  assert.equal(ui.document.querySelector('.summary-total').textContent,'7');
  const input=ui.document.querySelector('[aria-label="Search tracked products"]'); input.value='does-not-exist'; input.dispatchEvent(new ui.dom.window.Event('input'));
  assert.match(ui.document.querySelector('.cards').textContent,/No matching products/);
  ui.click('Clear filters'); assert.equal(ui.document.querySelectorAll('.product').length,2); assert.equal(input.value,'');
  ui.dom.window.close();
});

test('successful tracking opens overview, failed selection stays on packages, and saved page restores', () => {
  const ui=setup({page:'packages',period:7});
  const discovery={packages:[{name:'alpha',description:'Package'}],note:'Public search'};
  ui.update({discovery}); ui.click('Select visible'); ui.click('Track selected packages');
  ui.update({discovery,busy:true,products:[{source:'npm',id:'alpha'}]});
  assert.equal(ui.document.querySelector('#view-packages').hidden,false);
  ui.update({discovery,products:[{source:'npm',id:'alpha'}]});
  assert.equal(ui.document.querySelector('#view-overview').hidden,false);
  assert.equal((ui.uiState as any).period,7);
  ui.document.querySelector('[aria-controls="view-packages"]').click(); ui.click('Track selected packages');
  ui.update({discovery,products:[{source:'npm',id:'alpha'}],notice:'Track up to 50 products.'});
  assert.equal(ui.document.querySelector('#view-packages').hidden,false);
  assert.match(ui.document.querySelector('.notice').textContent,/50 products/); ui.dom.window.close();
});

test('saved observation changes, source health and export remain accurate when product filters change', () => {
  const ui = setup(); const p={source:'openvsx',id:'pub.ext'};
  const history=[{product:p,fetchedAt:'2026-11-01T12:00:00.000Z',metric:{kind:'count',value:120}},{product:p,fetchedAt:'2026-11-02T12:00:00.000Z',metric:{kind:'count',value:100}}];
  ui.update({products:[p],history,readings:[{product:p,health:'stale',error:'offline',stale:true,metric:{kind:'count',value:100,label:'Downloads'}}]});
  assert.match(ui.document.querySelector('.observation-change').textContent,/Last saved change: -20 since previous successful fetch/);
  assert.match(ui.document.querySelector('.source-health').textContent,/Source failed/);
  assert.match(ui.document.querySelector('.observation-history').textContent,/Saved observations \(2\)/);
  assert.equal(ui.document.querySelectorAll('.observation-history tbody tr').length,2);
  const search=ui.document.querySelector('[aria-label="Search tracked products"]'); search.value='missing'; search.dispatchEvent(new ui.dom.window.Event('input'));
  ui.click('Export CSV'); assert.equal(ui.messages.at(-1).type,'export');
  ui.update({products:[],history:[],readings:[]});
  const exportButton=[...ui.document.querySelectorAll('button')].find((b:any)=>b.textContent==='Export CSV') as any;
  assert.equal(exportButton.disabled,true); ui.dom.window.close();
});

test('npm saved changes follow the selected rolling window and missing baselines stay unavailable', () => {
  const ui=setup(); const p={source:'npm',id:'react'};
  const history=[{product:p,fetchedAt:'2026-11-01T12:00:00.000Z',metric:{kind:'npm',end:'2026-10-31',totals:{7:10,30:20,90:null}}},{product:p,fetchedAt:'2026-11-02T12:00:00.000Z',metric:{kind:'npm',end:'2026-11-01',totals:{7:7,30:40,90:90}}}];
  ui.update({products:[p],history});
  assert.match(ui.document.querySelector('.observation-change').textContent,/\+20 since previous successful fetch/);
  assert.match(ui.document.querySelector('.observation-change').textContent,/rolling 30-day total, not new downloads/);
  ui.click('7 days'); assert.match(ui.document.querySelector('.observation-change').textContent,/-3 since/);
  ui.click('90 days'); assert.match(ui.document.querySelector('.observation-change').textContent,/unavailable.*incomplete/);
  ui.dom.window.close();
});

test('product groups scope npm totals and release markers without mixing other source metrics or rendering labels as HTML', () => {
  const ui=setup({page:'insights'});
  const npm={source:'npm',id:'react'}, other={source:'npm',id:'other'}, vsx={source:'openvsx',id:'pub.ext'};
  const metric={kind:'npm',daily:[],start:'2026-05-05',end:'2026-10-31',windows:[{days:7,total:7,previous:7,change:0},{days:30,total:30,previous:30,change:0},{days:90,total:90,previous:90,change:0}]};
  const insights={groups:[{id:'g_one',name:'<b>My product</b>',keys:['npm:react','openvsx:pub.ext']}],markers:[{id:'r_one',key:'npm:react',date:'2026-10-30',label:'<img src=x onerror=alert(1)>'},{id:'r_two',key:'npm:other',date:'2026-10-30',label:'Other release'},{id:'r_old',key:'npm:react',date:'2020-01-01',label:'Outside chart'}]};
  ui.update({products:[npm,other,vsx],insights,readings:[{product:npm,metric},{product:other,metric},{product:vsx,metric:{kind:'count',value:9999,label:'Downloads'}}]});
  assert.equal(ui.document.querySelector('#view-insights').hidden,false);
  const group=ui.document.querySelector('[aria-label="Product group filter"]'); group.value='g_one'; group.dispatchEvent(new ui.dom.window.Event('change'));
  assert.equal(ui.document.querySelector('.summary-total').textContent,'30'); assert.equal(ui.document.querySelectorAll('.product').length,2);
  assert.match(ui.document.querySelector('.group-scope').textContent,/<b>My product<\/b>/);
  assert.equal(ui.document.querySelectorAll('img').length,0);
  assert.equal(ui.document.querySelectorAll('.release-marker').length,2,'Matching marker appears on combined and individual npm charts only');
  for(const line of ui.document.querySelectorAll('.release-marker')) {assert.ok(Number.isFinite(Number(line.getAttribute('x1')))); assert.match(line.textContent,/<img src=x/);}
  ui.click('Open VSX'); assert.equal(ui.document.querySelectorAll('.product').length,1); assert.equal(ui.document.querySelector('.summary-total').textContent,'30');
  assert.equal((ui.uiState as any).groupId,'g_one'); ui.dom.window.close();
});

test('insights form drafts survive host updates, edits send stable IDs, and busy controls block submissions', () => {
  const ui=setup(); const products=[{source:'npm',id:'react'}];
  const insights={groups:[{id:'g_one',name:'Group',keys:['npm:react']}],markers:[{id:'r_one',key:'npm:react',date:'2026-10-30',label:'v1'}]};
  ui.update({products,insights});
  const group=ui.document.querySelector('[aria-label="Edit product group"]'); group.value='g_one'; group.dispatchEvent(new ui.dom.window.Event('change'));
  const name=ui.document.querySelector('[aria-label="Group name"]'); name.value='Renamed';
  ui.update({products,insights,busy:true}); assert.equal(name.value,'Renamed');
  const before=ui.messages.length; ui.document.querySelector('.insight-form').dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true})); assert.equal(ui.messages.length,before);
  ui.update({products,insights,busy:false}); ui.document.querySelector('.insight-form').dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true}));
  assert.equal(JSON.stringify(ui.messages.at(-1)),JSON.stringify({type:'groupSave',group:{id:'g_one',name:'Renamed',keys:['npm:react']}}));
  const marker=ui.document.querySelector('[aria-label="Edit release marker"]'); marker.value='r_one'; marker.dispatchEvent(new ui.dom.window.Event('change'));
  ui.document.querySelector('[aria-label="Release label"]').value='v1.1';
  ui.document.querySelectorAll('.insight-form')[1].dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true}));
  assert.equal(ui.messages.at(-1).marker.id,'r_one'); assert.equal(ui.messages.at(-1).marker.label,'v1.1');
  ui.click('Delete marker'); assert.equal(ui.messages.at(-1).type,'markerDelete'); assert.equal(ui.messages.at(-1).id,'r_one');
  ui.dom.window.close();
});

test('saved release markers expose direct deletion, preserve other markers and clear the deleted selection', () => {
  const ui=setup({page:'insights'}), products=[{source:'npm',id:'react'}];
  const first={id:'r_first',key:'npm:react',date:'2026-10-01',label:'v1'}, second={...first,id:'r_second',date:'2026-10-15',label:'<img src=x>'};
  const data={products,insights:{groups:[],markers:[first,second]}};
  ui.update(data);
  const buttons=()=>[...ui.document.querySelectorAll('.release-list button')] as any[];
  assert.equal(buttons().length,2); assert.equal(ui.document.querySelectorAll('.release-list img').length,0);
  buttons()[0].click(); assert.equal(JSON.stringify(ui.messages.at(-1)),JSON.stringify({type:'markerDelete',id:'r_second'}));
  ui.update({...data,busy:true}); assert.ok(buttons().every(b=>b.disabled));
  const count=ui.messages.length; buttons()[0].click(); assert.equal(ui.messages.length,count);
  ui.update(data);
  const editor=ui.document.querySelector('[aria-label="Edit release marker"]'); editor.value=second.id; editor.dispatchEvent(new ui.dom.window.Event('change'));
  const launch=ui.document.querySelector('[aria-label="Launch release marker"]'); launch.value=second.id;
  ui.update({products,insights:{groups:[],markers:[first]},notice:'Release marker deleted.'});
  assert.equal(buttons().length,1); assert.match(ui.document.querySelector('.release-list').textContent,/v1/);
  assert.equal(editor.value,''); assert.equal(ui.document.querySelector('[aria-label="Release label"]').value,''); assert.equal(launch.value,first.id);
  buttons()[0].click(); assert.equal(ui.messages.at(-1).id,first.id);
  ui.update({products,insights:{groups:[],markers:[]}});
  assert.equal(buttons().length,0); assert.match(ui.document.querySelector('.release-list').textContent,/No release markers yet/); assert.equal(launch.disabled,true);
  ui.dom.window.close();
});

test('custom comparison forms send UTC ranges and invalidate displayed results when input changes', () => {
  const ui=setup(); const products=[{source:'npm',id:'react'}]; ui.update({products});
  const values={'Range A start (UTC)':'2026-10-26','Range A end (UTC)':'2026-11-01','Range B start (UTC)':'2026-10-19','Range B end (UTC)':'2026-10-25'};
  for(const [label,value] of Object.entries(values)) ui.document.querySelector(`[aria-label="${label}"]`).value=value;
  ui.document.querySelector('[aria-label="Comparison target"]').value='product:npm:react';
  ui.document.querySelector('.comparison-form').dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true}));
  const request=ui.messages.at(-1).request; assert.equal(request.target,'product:npm:react'); assert.equal(request.a.end,'2026-11-01');
  const comparison={request,targetName:'react',computedAt:'2026-11-02T12:00:00Z',npmTotals:{a:0,b:null,products:1},rows:[{product:products[0],metric:'Daily npm downloads',a:{value:0,coverage:'7/7 complete days'},b:{value:null,coverage:'6/7 complete days'},difference:null,percent:null}],notes:['Partial data is unavailable.']};
  ui.update({products,comparison}); assert.match(ui.document.querySelector('.comparison-result').textContent,/A 0 \/ B Unavailable/);
  assert.match(ui.document.querySelector('.comparison-result').textContent,/6\/7 complete days/);
  const input=ui.document.querySelector('[aria-label="Range A end (UTC)"]'); input.value='2026-10-31'; input.dispatchEvent(new ui.dom.window.Event('input',{bubbles:true}));
  assert.match(ui.document.querySelector('.comparison-result').textContent,/Inputs changed/); assert.equal(ui.document.querySelector('.comparison-result table'),null);
  ui.dom.window.close();
});

test('Launch Review forms request equal windows, display coverage and disable exports for changed inputs', () => {
  const ui=setup({page:'launch'}); const p={source:'npm',id:'react'}, marker={id:'r_launch',key:'npm:react',date:'2026-10-19',label:'v0.6'};
  const comparison={request:{target:'product:npm:react',a:{start:'2026-10-19',end:'2026-10-25'},b:{start:'2026-10-12',end:'2026-10-18'}},targetName:'react',computedAt:'2026-11-02T12:00:00Z',npmTotals:{a:0,b:null,products:1},rows:[{product:p,metric:'Daily npm downloads',a:{value:0,coverage:'7/7 complete days'},b:{value:null,coverage:'6/7 complete days'},difference:null,percent:null}],notes:['Timing does not establish causation.']};
  const data={products:[p],insights:{groups:[],markers:[marker]},launchReport:{marker,days:7,comparison}};
  ui.update(data); assert.equal(ui.document.querySelector('#view-launch').hidden,false);
  ui.document.querySelector('.launch-form').dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true}));
  assert.equal(JSON.stringify(ui.messages.at(-1)),JSON.stringify({type:'launchReview',request:{markerId:'r_launch',target:'product:npm:react',days:7}}));
  ui.update(data);
  assert.match(ui.document.querySelector('.launch-result').textContent,/After 0 \/ Before Unavailable/);
  ui.click('Export card (SVG)'); assert.equal(ui.messages.at(-1).format,'svg'); assert.equal(ui.messages.at(-1).metric,'npm-total');
  const days=ui.document.querySelector('[aria-label="Days before and after"]'); days.value='14'; days.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true}));
  assert.match(ui.document.querySelector('.launch-result').textContent,/Inputs changed/);
  const exportButton=[...ui.document.querySelectorAll('button')].find((b:any)=>b.textContent==='Export card (PNG)') as any; assert.equal(exportButton.disabled,true);
  ui.dom.window.close();
});

test('Review launch shows progress and inline errors for the matching inputs, then allows a corrected review', () => {
  const ui=setup({page:'launch'}), p={source:'npm',id:'react'}, marker={id:'r_launch',key:'npm:react',date:'2026-10-02',label:'v1'};
  const data={products:[p],insights:{groups:[],markers:[marker]}};
  ui.update(data); ui.click('Review launch');
  assert.equal(ui.messages.at(-1).type,'launchReview'); assert.match(ui.document.querySelector('.launch-result').textContent,/Generating/);
  assert.equal(ui.document.querySelector('.launch-form button[type="submit"]').disabled,true);
  const request=ui.messages.at(-1).request;
  ui.update({...data,busy:true}); assert.match(ui.document.querySelector('.launch-result').textContent,/Generating/);
  const failure={request,message:'The full after-launch window ends 2026-11-08 UTC. Choose a shorter window or review after it completes.'};
  ui.update({...data,launchReviewError:failure});
  assert.match(ui.document.querySelector('.launch-result [role="alert"]').textContent,/2026-11-08/);
  assert.equal(ui.document.querySelector('.launch-form button[type="submit"]').disabled,false);
  assert.ok([...ui.document.querySelectorAll('.launch-exports button')].every((b:any)=>b.disabled));
  const days=ui.document.querySelector('[aria-label="Days before and after"]'); days.value='14'; days.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true}));
  assert.equal(ui.document.querySelector('.launch-result [role="alert"]'),null);
  ui.click('Review launch'); assert.equal(ui.messages.at(-1).request.days,14);
  const comparison={request:{target:request.target,a:{start:'2026-10-01',end:'2026-10-14'},b:{start:'2026-09-17',end:'2026-09-30'}},targetName:'react',computedAt:'2026-11-02T12:00:00Z',rows:[],notes:[]};
  ui.update({...data,launchReport:{marker,days:14,comparison}});
  assert.ok(ui.document.querySelector('.launch-result table')); assert.equal(ui.document.querySelector('.launch-result [role="alert"]'),null);
  ui.dom.window.close();
});

test('readiness, early mode, gapped charts, release notes and matched preview responses work together', () => {
  const ui=setup({page:'launch'}), p={source:'npm',id:'react'}, marker={id:'r_early',key:'npm:react',date:'2026-10-30',label:'v1',notes:'Fixed <startup>\nFaster.'};
  const data={products:[p],insights:{groups:[],markers:[marker]},dateLimits:{today:'2026-11-02'}};
  ui.update(data); assert.match(ui.document.querySelector('.launch-readiness').textContent,/3 of 7 days completed/); assert.match(ui.document.querySelector('.launch-readiness').textContent,/2026-11-06/);
  const review=ui.document.querySelector('.launch-form button[type="submit"]'); assert.equal(review.disabled,true);
  const mode=ui.document.querySelector('[aria-label="Review mode"]'); mode.value='early'; mode.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true})); assert.equal(review.disabled,false);
  ui.click('Review launch'); assert.equal(ui.messages.at(-1).request.mode,'early');
  const comparison={request:{target:'product:npm:react',a:{start:'2026-10-30',end:'2026-11-01'},b:{start:'2026-10-27',end:'2026-10-29'}},targetName:'react',computedAt:'2026-11-02T12:00:00Z',rows:[{product:p,metric:'Daily npm downloads',a:{value:null,coverage:'2/3 days'},b:{value:3,coverage:'3/3 days'},difference:null,percent:null}],notes:[]};
  (comparison as any).npmTotals={a:null,b:3,products:1};
  const daily=[{product:p,before:[{day:'2026-10-27',downloads:1},{day:'2026-10-28',downloads:1},{day:'2026-10-29',downloads:1}],after:[{day:'2026-10-30',downloads:3},{day:'2026-10-31',downloads:null},{day:'2026-11-01',downloads:0}]}];
  ui.update({...data,launchReport:{marker,days:7,mode:'early',actualDays:3,preliminary:true,comparison,daily}});
  assert.match(ui.document.querySelector('.preliminary-banner').textContent,/3 of 7/); assert.match(ui.document.querySelector('.launch-result .release-notes').textContent,/<startup>/); assert.equal(ui.document.querySelector('.launch-result startup'),null);
  assert.equal(ui.document.querySelectorAll('.launch-chart-grid svg').length,2); assert.equal(ui.document.querySelectorAll('.launch-chart-grid polyline').length,3); assert.match(ui.document.querySelector('.launch-comparison-chart tbody').textContent,/Unavailable/);
  const preview=ui.messages.at(-1); assert.equal(preview.type,'launchPreview');
  const receive=(requestId:string)=>ui.dom.window.dispatchEvent(new ui.dom.window.MessageEvent('message',{data:{type:'launchPreview',requestId,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"/>'}}));
  receive('stale'); assert.equal(ui.document.querySelector('.launch-card-preview img'),null);
  receive(preview.requestId); assert.match(ui.document.querySelector('.launch-card-preview img').src,/^data:image\/svg\+xml/); assert.match(ui.document.querySelector('.launch-card-preview figcaption').textContent,/Preliminary/);
  const metric=ui.document.querySelector('[aria-label="Share-card metric"]');
  metric.value='product:npm:react'; metric.dispatchEvent(new ui.dom.window.Event('change'));
  const updatedPreview=ui.messages.at(-1); assert.equal(updatedPreview.type,'launchPreview');
  assert.notEqual(updatedPreview.requestId,preview.requestId); assert.equal(updatedPreview.metric,'product:npm:react');
  receive(preview.requestId); assert.equal(ui.document.querySelector('.launch-card-preview img'),null);
  receive(updatedPreview.requestId); assert.ok(ui.document.querySelector('.launch-card-preview img'));
  mode.value='complete'; mode.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true})); assert.equal(ui.document.querySelector('.launch-card-preview').hidden,true); assert.equal(ui.document.querySelector('.launch-card-preview img'),null); receive(preview.requestId); assert.equal(ui.document.querySelector('.launch-card-preview img'),null);
  ui.update({...data,dateLimits:{today:'2026-10-30'}}); mode.value='early'; mode.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true})); assert.equal(review.disabled,true); assert.match(ui.document.querySelector('.launch-readiness').textContent,/2026-10-31/);
  const editor=ui.document.querySelector('[aria-label="Edit release marker"]'); editor.value=marker.id; editor.dispatchEvent(new ui.dom.window.Event('change'));
  assert.equal(ui.document.querySelector('textarea').value,marker.notes); ui.document.querySelector('textarea').value='Updated context'; ui.click('Save release marker'); assert.equal(ui.messages.at(-1).marker.notes,'Updated context');
  ui.dom.window.close();
});

test('empty Launch Review explains markers and creates one through Insights before returning to the selected release', () => {
  const ui=setup({page:'launch'}), products=[{source:'npm',id:'alpha'},{source:'npm',id:'beta'}];
  const findButton=(name:string)=>[...ui.document.querySelectorAll('button')].find((b:any)=>b.textContent===name) as any;
  ui.update({products:[]});
  assert.equal(findButton('Add release marker').disabled,true);
  assert.match(ui.document.querySelector('#launch-marker-help').textContent,/Track a product first/);
  ui.update({products});
  const markerSelect=ui.document.querySelector('[aria-label="Launch release marker"]');
  assert.equal(markerSelect.disabled,true); assert.match(markerSelect.textContent,/No release markers saved/);
  assert.match(ui.document.querySelector('#launch-marker-help').textContent,/not imported automatically/);
  assert.equal(findButton('Review launch').disabled,true);
  const count=ui.messages.length; ui.document.querySelector('.launch-form').dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true})); assert.equal(ui.messages.length,count);
  const later={id:'r_later',key:'npm:alpha',date:'2026-11-01',label:'Later'};
  ui.update({products,insights:{groups:[],markers:[later]}});
  ui.document.querySelector('[aria-label="Launch target"]').value='product:npm:beta';
  ui.click('Add release marker'); assert.equal(ui.document.querySelector('#view-insights').hidden,false);
  assert.equal(ui.document.querySelector('[aria-label="Release product"]').value,'npm:beta');
  assert.equal(ui.document.activeElement,ui.document.querySelector('[aria-label="Release label"]'));
  ui.document.querySelector('[aria-label="Release date (UTC)"]').value='2026-10-01';
  ui.document.querySelector('[aria-label="Release label"]').value='v1.0';
  ui.click('Save release marker'); assert.equal(ui.messages.at(-1).type,'markerSave'); assert.equal(ui.messages.at(-1).marker.key,'npm:beta');
  ui.update({products,insights:{groups:[],markers:[later]},busy:true}); assert.equal(ui.document.querySelector('#view-insights').hidden,false);
  ui.update({products,insights:{groups:[],markers:[later]},notice:'Failed to save.'}); assert.equal(ui.document.querySelector('#view-insights').hidden,false);
  const marker={id:'r_new',key:'npm:beta',date:'2026-10-01',label:'v1.0'};
  ui.update({products,insights:{groups:[],markers:[marker,later]},notice:'Release marker saved.'});
  assert.equal(ui.document.querySelector('#view-launch').hidden,false); assert.equal(markerSelect.value,'r_new');
  assert.equal(ui.document.querySelector('[aria-label="Launch target"]').value,'product:npm:beta');
  assert.equal(findButton('Review launch').disabled,false); assert.equal(markerSelect.disabled,false);
  ui.update({products,insights:{groups:[],markers:[]}}); assert.equal(markerSelect.disabled,true); assert.equal(findButton('Review launch').disabled,true);
  ui.dom.window.close();
});

test('monitoring forms preserve stable IDs, display unread alerts safely and send acknowledgement requests', () => {
  const ui=setup(); const p={source:'openvsx',id:'pub.ext'};
  const rule={id:'m_goal',key:'openvsx:pub.ext',name:'Goal',metric:'count',kind:'milestone',threshold:100,enabled:true,reached:true,lastValue:100};
  const alert={id:'a_one',ruleId:'m_goal',key:rule.key,name:'<img src=x>',metric:'count',kind:'milestone',threshold:100,value:100,createdAt:'2026-11-02T12:00:00Z',acknowledged:false};
  ui.update({products:[p],monitoring:{rules:[rule],alerts:[alert]}}); assert.equal(ui.document.querySelector('.alert-badge').textContent,'1'); assert.equal(ui.document.querySelectorAll('img').length,0);
  const editor=ui.document.querySelector('[aria-label="Edit monitoring rule"]'); editor.value='m_goal'; editor.dispatchEvent(new ui.dom.window.Event('change'));
  ui.document.querySelector('[aria-label="Rule name"]').value='Edited'; ui.document.querySelector('[aria-label="Rule enabled"]').checked=false;
  ui.document.querySelector('.rule-form').dispatchEvent(new ui.dom.window.Event('submit',{cancelable:true}));
  assert.equal(ui.messages.at(-1).rule.id,'m_goal'); assert.equal(ui.messages.at(-1).rule.enabled,false); assert.equal(ui.messages.at(-1).rule.threshold,100);
  ui.click('Mark alert read'); assert.equal(ui.messages.at(-1).type,'alertAck'); assert.equal(ui.messages.at(-1).id,'a_one');
  ui.update({products:[p],monitoring:{rules:[rule],alerts:[{...alert,acknowledged:true}]}}); assert.equal(ui.document.querySelector('.alert-badge').hidden,true);
  ui.dom.window.close();
});

test('saved monitoring rules can be deleted directly by ID and busy refreshes disable deletion', () => {
  const ui=setup({page:'launch'}), p={source:'openvsx',id:'pub.ext'};
  const first={id:'m_first',key:'openvsx:pub.ext',name:'First',metric:'count',kind:'milestone',threshold:100,enabled:true};
  const second={...first,id:'m_second',name:'Second'};
  const data={products:[p],monitoring:{rules:[first,second],alerts:[]}};
  ui.update(data);
  const remove=()=>ui.document.querySelector('[aria-label="Delete monitoring rule: Second"]');
  remove().click(); assert.equal(JSON.stringify(ui.messages.at(-1)),JSON.stringify({type:'ruleDelete',id:'m_second'}));
  ui.update({...data,busy:true}); assert.equal(remove().disabled,true);
  const count=ui.messages.length; remove().click(); assert.equal(ui.messages.length,count);
  ui.update(data); assert.equal(remove().disabled,false);
  const editor=ui.document.querySelector('[aria-label="Edit monitoring rule"]'); editor.value='m_second'; editor.dispatchEvent(new ui.dom.window.Event('change'));
  ui.update({products:[p],monitoring:{rules:[first],alerts:[]},notice:'Monitoring rule deleted. Previous alerts remain.'});
  assert.equal(remove(),null); assert.equal(editor.value,''); assert.equal(ui.document.querySelector('[aria-label="Rule name"]').value,'');
  assert.equal(ui.document.querySelector('.monitor-rules').textContent.includes('First'),true);
  ui.update({products:[p],monitoring:{rules:[],alerts:[]}}); assert.match(ui.document.querySelector('.monitor-rules').textContent,/No monitoring rules yet/);
  ui.dom.window.close();
});

test('PNG rendering failures report the matching request ID so SVG export remains an explicit fallback', () => {
  const ui=setup();
  ui.dom.window.Image=class { onerror: (()=>void)|undefined; set src(value:string) {this.onerror?.();} };
  ui.dom.window.dispatchEvent(new ui.dom.window.MessageEvent('message',{data:{type:'renderShareCard',requestId:'request-one',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"/>'}}));
  assert.equal(JSON.stringify(ui.messages.at(-1)),JSON.stringify({type:'shareCardError',requestId:'request-one'})); ui.dom.window.close();
});

test('PNG conversion bridge uses a 1200 by 630 canvas and returns PNG data for the matching export request', () => {
  const ui=setup(); const png=cardPng().toString('base64'); let source='',draw:any[]=[];
  ui.dom.window.Image=class {onload:(()=>void)|undefined; set src(value:string) {source=value; this.onload?.();}};
  ui.dom.window.HTMLCanvasElement.prototype.getContext=function(){return {drawImage:(...args:any[])=>{draw=args;}};};
  ui.dom.window.HTMLCanvasElement.prototype.toDataURL=function(type:string){assert.equal(this.width,1200);assert.equal(this.height,630);assert.equal(type,'image/png');return 'data:image/png;base64,'+png;};
  ui.dom.window.dispatchEvent(new ui.dom.window.MessageEvent('message',{data:{type:'renderShareCard',requestId:'png-one',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"/>'}}));
  assert.match(source,/^data:image\/svg\+xml/); assert.equal(draw[3],1200); assert.equal(draw[4],630);
  assert.equal(ui.messages.at(-1).type,'saveShareCard'); assert.equal(ui.messages.at(-1).requestId,'png-one'); assert.equal(ui.messages.at(-1).data,png); ui.dom.window.close();
});
