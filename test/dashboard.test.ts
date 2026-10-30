import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
