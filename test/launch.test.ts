import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LaunchReport, MonitorState, acknowledgeAlerts, deleteRule, evaluateRules, launchMarkdown, launchReview, restoreMonitor, saveRule, shareCard, validateCardPng } from '../src/launch';
import { Product, Reading, dateAt, windows } from '../src/model';
import { cardPng } from './png-fixture';

const now = new Date('2026-11-02T12:00:00Z');
const p: Product = { source: 'openvsx', id: 'pub.ext' }, npm: Product = { source: 'npm', id: 'react' };
const initial = (): MonitorState => ({ rules: [], alerts: [] });
const reading = (value: number, at = now, product = p): Reading => ({ product, fetchedAt: at.toISOString(), metric: { kind: 'count', value, label: 'Downloads' } });
const milestone = { name: 'Downloads goal', key: 'openvsx:pub.ext', metric: 'count', kind: 'milestone', threshold: 100, enabled: true };
function report(): LaunchReport {
  const daily = Array.from({ length: 180 }, (_, i) => ({ day: dateAt(now, i - 180), downloads: i >= 166 ? 2 : 1 }));
  const data: Reading = { product: npm, fetchedAt: now.toISOString(), metric: { kind: 'npm', daily, windows: windows(daily, now), start: dateAt(now, -180), end: dateAt(now, -1) } };
  return launchReview({ markerId: 'r_one', target: 'all', days: 7 }, [npm], [data], [], { groups: [], markers: [{ id: 'r_one', key: 'npm:react', date: '2026-10-19', label: 'v0.6' }] }, now);
}

test('launch windows are equal, inclusive, contain the release day in After and retain coverage semantics', () => {
  const r = report();
  assert.deepEqual(r.comparison.request.a, { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(r.comparison.request.b, { start: '2026-10-12', end: '2026-10-18' });
  assert.equal(r.comparison.rows[0]!.a.value, 14); assert.equal(r.comparison.rows[0]!.b.value, 7);
  assert.match(r.comparison.notes.join(' '), /do not establish causation/);
  const insights = { groups: [{id:'g_wrong',name:'Wrong',keys:['openvsx:pub.ext']}], markers: [r.marker] };
  assert.throws(() => launchReview({ markerId: 'r_one', target: 'group:g_wrong', days: 7 }, [npm,p], [], [], insights, now), /must belong/);
  assert.throws(() => launchReview({ markerId: 'r_one', target: 'all', days: 30 }, [npm], [], [], insights, now), /full after-launch/);
  assert.throws(() => launchReview({ markerId: 'r_one', target: 'all', days: 8 }, [npm], [], [], insights, now), /7-, 14-/);
  assert.throws(() => launchReview({ markerId: 'missing', target: 'all', days: 7 }, [npm], [], [], insights, now), /saved release/);
});

test('early reviews use equal completed UTC windows, preserve gaps and mark every export preliminary', () => {
  const daily=Array.from({length:20},(_,i)=>({day:dateAt(now,i-20),downloads:i===19?0:3})).filter(d=>d.day!=='2026-10-31');
  const reading: Reading={product:npm,fetchedAt:now.toISOString(),metric:{kind:'npm',daily,windows:windows(daily,now),start:dateAt(now,-20),end:dateAt(now,-1)}};
  const insights: any={groups:[],markers:[{id:'r_early',key:'npm:react',date:'2026-10-30',label:'v1',notes:'Fixed <startup>\nLess waiting.'}]};
  const request={markerId:'r_early',target:'all',days:7,mode:'early'};
  const r=launchReview(request,[npm],[reading],[],insights,now);
  assert.equal(r.actualDays,3); assert.equal(r.preliminary,true); assert.equal(r.days,7);
  assert.deepEqual(r.comparison.request.a,{start:'2026-10-30',end:'2026-11-01'}); assert.deepEqual(r.comparison.request.b,{start:'2026-10-27',end:'2026-10-29'});
  assert.equal(r.daily![0]!.after[1]!.downloads,null); assert.equal(r.daily![0]!.after[2]!.downloads,0); assert.equal(r.comparison.rows[0]!.a.value,null);
  assert.match(launchMarkdown(r),/PRELIMINARY/); assert.match(launchMarkdown(r),/Fixed &lt;startup&gt;/); assert.match(launchMarkdown(r),/Compare|Daily comparison/);
  assert.match(shareCard(r,'npm-total'),/PRELIMINARY/); assert.match(shareCard(r,'npm-total'),/Fixed &lt;startup&gt;/);
  const failed=launchReview(request,[npm],[{...reading,error:'offline'}],[],insights,now); assert.ok(failed.daily![0]!.after.every(d=>d.downloads===null));
  insights.markers[0].date='2026-11-02'; assert.throws(()=>launchReview(request,[npm],[reading],[],insights,now),/No completed UTC days/);
  insights.markers[0].date='2026-11-01'; const one=launchReview(request,[npm],[reading],[],insights,new Date('2026-11-02T00:00:00Z')); assert.equal(one.actualDays,1);
  insights.markers[0].date='2026-10-19'; const complete=launchReview(request,[npm],[reading],[],insights,now); assert.equal(complete.preliminary,false); assert.equal(complete.actualDays,7);
  assert.throws(()=>launchReview({...request,mode:'invalid'},[npm],[reading],[],insights,now),/early review/);
});

test('milestones trigger once on fresh observations, survive restart and ignore cached/failure samples', () => {
  let state = saveRule(initial(), milestone, [p], [], now);
  state = evaluateRules(state, [p], [reading(100)], now); assert.equal(state.alerts.length, 1); assert.equal(state.rules[0]!.reached, true);
  state = restoreMonitor(JSON.parse(JSON.stringify(state)), [p], now);
  const later = new Date(now.getTime() + 600_000);
  state = evaluateRules(state, [p], [reading(200, later)], later); assert.equal(state.alerts.length, 1);
  let pending = saveRule(initial(), milestone, [p], [], now);
  pending = evaluateRules(pending, [p], [{...reading(200), cached:true}, {...reading(200), error:'offline'}], now);
  assert.equal(pending.alerts.length, 0); assert.equal(pending.rules[0]!.lastValue, undefined);
  const acknowledged = acknowledgeAlerts(state, 'all'); assert.equal(acknowledged.alerts[0]!.acknowledged, true);
  assert.equal(deleteRule(acknowledged, state.rules[0]!.id).alerts.length, 1, 'Deleting a rule keeps historical alerts');
  assert.equal(restoreMonitor(state, [], now).alerts.length, 0, 'Untracking removes related monitoring data');
});

test('percent-change alerts use positive baselines, directional thresholds and a one-hour cooldown', () => {
  let state = saveRule(initial(), {...milestone,kind:'increase',threshold:20}, [p], [reading(100)], now);
  const tick = (minutes: number, value: number): void => { const at = new Date(now.getTime()+minutes*60000); state=evaluateRules(state,[p],[reading(value,at)],at); };
  tick(10,125); assert.equal(state.alerts.length,1); assert.equal(state.alerts[0]!.previousValue,100);
  tick(20,160); assert.equal(state.alerts.length,1); assert.equal(state.rules[0]!.lastValue,160,'Cooldown still advances baseline');
  tick(70,200); assert.equal(state.alerts.length,2);
  let zero=saveRule(initial(),{...milestone,kind:'increase',threshold:20},[p],[reading(0)],now);
  const at=new Date(now.getTime()+600000); zero=evaluateRules(zero,[p],[reading(100,at)],at); assert.equal(zero.alerts.length,0);
  let drop=saveRule(initial(),{...milestone,kind:'decrease',threshold:20},[p],[reading(100)],now);
  drop=evaluateRules(drop,[p],[reading(75,at)],at); assert.equal(drop.alerts.length,1);
  const paused=saveRule(initial(),{...milestone,enabled:false},[p],[],now);
  assert.equal(evaluateRules(paused,[p],[reading(200)],now).alerts.length,0);
});

test('rule validation, editing/rearming, source metrics, limits and partial npm observations are handled explicitly', () => {
  for (const threshold of [0,-1,NaN,Infinity,1.5]) assert.throws(()=>saveRule(initial(),{...milestone,threshold},[p],[],now));
  assert.throws(()=>saveRule(initial(),{...milestone,metric:'npm30'},[p],[],now),/matching/);
  assert.throws(()=>saveRule(initial(),{...milestone,metric:['count']},[p],[],now),/matching/);
  assert.throws(()=>saveRule(initial(),{...milestone,kind:['milestone']},[p],[],now),/valid rule/);
  assert.throws(()=>saveRule(initial(),{...milestone,kind:'increase',threshold:10001},[p],[],now));
  let state=saveRule(initial(),milestone,[p],[],now); state=evaluateRules(state,[p],[reading(100)],now);
  state=saveRule(state,{...milestone,id:state.rules[0]!.id},[p],[reading(100)],now); assert.equal(state.rules[0]!.reached,false);
  let many=initial(); for(let i=0;i<50;i++) many=saveRule(many,{...milestone,name:`Rule ${i}`},[p],[],now);
  assert.throws(()=>saveRule(many,milestone,[p],[],now),/50/);
  const npmRule=saveRule(initial(),{...milestone,key:'npm:react',metric:'npm30'},[npm],[],now);
  const partial: Reading={product:npm,fetchedAt:now.toISOString(),metric:{kind:'npm',start:'2026-05-06',end:'2026-11-01',daily:[],windows:[{days:30,total:null,previous:null,change:null}]}};
  assert.equal(evaluateRules(npmRule,[npm],[partial],now).alerts.length,0);
  assert.equal(restoreMonitor({rules:[null,{...milestone,id:'__proto__'}],alerts:[{}]},[p],now).rules.length,0);
});

test('reports and standalone share cards escape user text and retain unavailable values and distinct metrics', () => {
  const r=report(); r.marker.label='<script>alert(1)</script>'; r.comparison.targetName='My <img> product';
  const markdown=launchMarkdown(r); assert.match(markdown,/After: 2026-10-19/); assert.match(markdown,/&lt;script&gt;/); assert.doesNotMatch(markdown,/<script>/);
  const svg=shareCard(r,'npm-total'); assert.match(svg,/width="1200" height="630"/); assert.match(svg,/Daily npm downloads/); assert.match(svg,/Timing does not establish causation/); assert.doesNotMatch(svg,/<script>|<img>/);
  r.comparison.npmTotals!.a=null; assert.match(shareCard(r,'npm-total'),/Unavailable/);
  assert.throws(()=>shareCard(r,'product:npm:untracked'),/metric/);
  const countReport={...r,comparison:{...r.comparison,npmTotals:undefined,rows:[{product:p,metric:'Observed download-count change',a:{value:2,coverage:'2 saved observations',firstAt:'2026-10-19T12:00:00Z',lastAt:'2026-10-24T12:00:00Z'},b:{value:0,coverage:'2 saved observations'},difference:2,percent:null}]}};
  const countSvg=shareCard(countReport,'product:openvsx:pub.ext'); assert.match(countSvg,/Observed count changes/); assert.match(countSvg,/2026-10-24T12:00:00Z/);
});

test('share cards distinguish growth, decline, zero baselines and missing coverage without inventing percentages', () => {
  const r=report(); r.comparison.targetName='W'.repeat(150); r.marker.label='A very long release label '.repeat(10);
  r.comparison.npmTotals={a:369,b:0,products:1};
  let svg=shareCard(r,'npm-total'); assert.match(svg,/AFTER RELEASE/); assert.match(svg,/BEFORE RELEASE/);
  assert.match(svg,/>\+369<\/text>/); assert.match(svg,/Before is zero; no percentage baseline/); assert.doesNotMatch(svg,/Infinity|NaN/);
  r.comparison.npmTotals.b=123; svg=shareCard(r,'npm-total'); assert.match(svg,/>\+200\.0%<\/text>/);
  r.comparison.npmTotals.a=0; svg=shareCard(r,'npm-total'); assert.match(svg,/>-123<\/text>/); assert.match(svg,/>-100\.0%<\/text>/); assert.match(svg,/#ffb6ab/);
  r.comparison.npmTotals.a=null; svg=shareCard(r,'npm-total'); assert.match(svg,/Needs complete values in both windows/); assert.doesNotMatch(svg,/NaN|Infinity/);
  r.comparison.npmTotals={a:Number.MAX_SAFE_INTEGER,b:1,products:1}; svg=shareCard(r,'npm-total');
  const {JSDOM}=require('jsdom'); const dom=new JSDOM(svg,{contentType:'image/svg+xml'});
  assert.ok(dom.window.document.querySelector('desc').textContent.includes('9,007,199,254,740,991'));
  assert.equal(dom.window.document.querySelectorAll('script, image, foreignObject').length,0);
  assert.ok([...dom.window.document.querySelectorAll('text')].every((t:any)=>Number(t.getAttribute('font-size'))>0));
  dom.window.close();
});

test('PNG export validation accepts a complete card image and rejects corruption, dimensions and malformed payloads', () => {
  const png=cardPng(); assert.deepEqual(validateCardPng(png.toString('base64')),png);
  const corrupt=Buffer.from(png); corrupt[corrupt.length-1]=corrupt[corrupt.length-1]!^1;
  for(const data of [corrupt.toString('base64'),cardPng(1,1).toString('base64'),'bad',png.subarray(0,-12).toString('base64'),'a'.repeat(3_000_001)]) assert.throws(()=>validateCardPng(data));
});

test('alert retention is bounded and malformed or obsolete monitoring state is discarded', () => {
  const alerts=Array.from({length:120},(_,i)=>({id:`a_${i}`,ruleId:'m_old',key:'openvsx:pub.ext',name:'Goal',metric:'count',kind:'milestone',threshold:100,value:100,createdAt:new Date(now.getTime()-i*1000).toISOString(),acknowledged:false}));
  const expired={...alerts[0],id:'a_expired',createdAt:new Date(now.getTime()-91*86400000).toISOString()};
  const state=restoreMonitor({rules:[],alerts:[...alerts,expired]},[p],now); assert.equal(state.alerts.length,100); assert.equal(state.alerts.at(-1)!.id,'a_0');
  assert.equal(restoreMonitor(state,[],now).alerts.length,0);
});
