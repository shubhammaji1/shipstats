import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Providers } from '../src/providers';
import { dateAt, windows, Day, Product } from '../src/model';
import { cardPng } from './png-fixture';
const { JSDOM } = require('jsdom');
const Module = require('node:module');

// Run the real extension controller and dashboard together, replacing only VS Code
// services and network providers. Message ordering and persistence remain real.
function harness(initial: { products?: Product[]; settings?: Record<string, string>; identityKey?: string; input?: string; history?: unknown; insights?: unknown; monitoring?: unknown; cancelExport?: boolean; failHistoryWrite?: boolean; failInsightsWrite?: boolean; failMonitorWrite?: boolean; failExport?: boolean } = {}) {
  const state = new Map<string, unknown>(), settings = new Map<string, unknown>(Object.entries(initial.settings ?? {}));
  if (initial.products) state.set('products', initial.products);
  if (initial.identityKey) state.set('npmDiscoveryIdentity', initial.identityKey);
  if (initial.history) state.set('history.v1', initial.history);
  if (initial.insights) state.set('insights.v1', initial.insights);
  if (initial.monitoring) state.set('monitor.v1', initial.monitoring);
  const writes: { uri: unknown; text: string; bytes: Buffer }[] = [], saveOptions: any[] = [];
  let saveDialogs = 0;
  const commands = new Map<string, () => Promise<void>>(), posted: any[] = [];
  let receive: (m: unknown) => void, dom: any, sourcePrompts = 0;
  class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
  const disposable = () => ({ dispose() {} });
  const vscode = {
    EventEmitter, TreeItem: class { constructor(public label: string) {} },
    StatusBarAlignment: { Left: 1 }, ViewColumn: { One: 1 }, ConfigurationTarget: { Global: 1 },
    Uri: { file: (path: string) => ({ path }), joinPath: (base: any, ...parts: string[]) => ({ path: join(base.path, ...parts), toString() { return this.path; } }) },
    workspace: {
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => settings.get(key) ?? fallback,
        update: async (key: string, value: unknown) => { settings.set(key, value); } }),
      onDidChangeConfiguration: disposable,
      fs: { writeFile: async (uri: unknown, data: Uint8Array) => { if (initial.failExport) throw new Error('Export permission denied'); writes.push({ uri, text: Buffer.from(data).toString('utf8'), bytes: Buffer.from(data) }); } }
    },
    commands: { registerCommand: (id: string, fn: () => Promise<void>) => { commands.set(id, fn); return disposable(); } },
    window: {
      registerTreeDataProvider: disposable,
      createStatusBarItem: () => ({ ...disposable(), show() {} }),
      showErrorMessage: async () => {},
      showQuickPick: async (options: unknown[]) => { sourcePrompts++; return options[0]; },
      showInputBox: async () => initial.input,
      showSaveDialog: async (options: unknown) => { saveDialogs++; saveOptions.push(options); return initial.cancelExport ? undefined : { path: '/selected/history.csv' }; },
      createWebviewPanel: () => ({
        webview: { cspSource: 'mock:', asWebviewUri: (uri: any) => uri,
          onDidReceiveMessage: (fn: (m: unknown) => void) => { receive = fn; return disposable(); },
          postMessage: (data: unknown) => {
            const message = JSON.parse(JSON.stringify(data)); posted.push(message);
            dom?.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message })); return Promise.resolve(true);
          } },
        onDidDispose: disposable, reveal() {}, dispose() {}, visible: true
      })
    }
  };
  const context: any = { subscriptions: [], extensionUri: { path: join(__dirname, '../..') },
    globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { if (initial.failHistoryWrite && key === 'history.v1') throw new Error('History storage unavailable'); if (initial.failInsightsWrite && key === 'insights.v1') throw new Error('Insights storage unavailable'); if (initial.failMonitorWrite && key === 'monitor.v1') throw new Error('Monitoring storage unavailable'); state.set(key, value); } },
    secrets: { get: async () => undefined, delete: async () => {}, store: async () => {} } };
  const originalLoad = Module._load;
  try {
    Module._load = function(id: string, ...args: unknown[]) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
    delete require.cache[require.resolve('../src/extension')];
    require('../src/extension').activate(context);
  } finally { Module._load = originalLoad; }
  const app = context.subscriptions[0];
  const drain = (): Promise<void> => app.queue;
  return {
    state, settings, posted, drain, writes, saveOptions,
    get saveDialogs() { return saveDialogs; },
    get document() { return dom.window.document; },
    get sourcePrompts() { return sourcePrompts; },
    get latest() { return posted.at(-1); },
    async open() {
      await commands.get('shipstats.open')!();
      dom = new JSDOM('<main id="app"></main>', { runScripts: 'outside-only' });
      dom.window.acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage: (m: unknown) => receive(m) });
      dom.window.eval(readFileSync(join(__dirname, '../../media/dashboard.js'), 'utf8'));
      await drain();
    },
    send(message: unknown) { receive(message); },
    async search(identity: string, scope = false) { receive({ type: 'discover', identity, scope }); await drain(); },
    async select(names: string[]) { receive({ type: 'select', names }); await drain(); },
    close() { app.dispose(); dom?.window.close(); }
  };
}

const fixtureNpm: Providers['npm'] = async () => {
  const now = new Date(), daily: Day[] = Array.from({ length: 180 }, (_, i) => ({ day: dateAt(now, i - 180), downloads: 1 }));
  return { kind: 'npm', daily, windows: windows(daily, now), start: dateAt(now, -180), end: dateAt(now, -1) };
};

test('switching username clears previous npm cards, totals and picker before the new request completes', async () => {
  const originalDiscover = Providers.prototype.discover, originalNpm = Providers.prototype.npm;
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  Providers.prototype.discover = async identity => {
    if (identity === 'bob') { entered(); await pending; }
    return { packages: [{ name: `${identity}-pkg`, description: identity }], note: 'Fixture registry search' };
  };
  Providers.prototype.npm = fixtureNpm;
  const ui = harness();
  try {
    await ui.open(); await ui.search('alice'); await ui.select(['alice-pkg']);
    assert.match(ui.document.querySelector('.cards').textContent, /alice-pkg/);
    assert.equal(ui.document.querySelector('.summary-total').textContent, '30');
    const filter = ui.document.querySelector('[aria-label="Filter discovered packages"]'); filter.value = 'alice'; filter.dispatchEvent(new ui.document.defaultView.Event('input'));
    ui.send({ type: 'discover', identity: 'bob', scope: false }); await started;
    assert.deepEqual(ui.latest.products, [], 'Previous npm tracking clears while searching');
    assert.deepEqual(ui.latest.readings, [], 'Previous readings clear while searching');
    assert.deepEqual(ui.latest.history, [], 'Prior account history clears before the new request resolves');
    assert.equal(ui.latest.discovery, undefined, 'Previous candidates clear while searching');
    assert.doesNotMatch(ui.document.querySelector('.cards').textContent, /alice-pkg/);
    assert.equal(ui.document.querySelector('.summary-total').textContent, '—');
    assert.equal(filter.value, '', 'Previous filter clears');
    release(); await ui.drain();
    assert.equal(ui.document.querySelectorAll('.package-option').length, 1);
    assert.match(ui.document.querySelector('.package-list').textContent, /bob-pkg/);
    assert.equal(ui.document.querySelector('[type="checkbox"]').checked, false);
    await ui.select(['bob-pkg']);
    assert.deepEqual(ui.state.get('products'), [{ source: 'npm', id: 'bob-pkg' }]);
    assert.doesNotMatch(ui.document.querySelector('.cards').textContent, /alice-pkg/);
  } finally { release(); ui.close(); Providers.prototype.discover = originalDiscover; Providers.prototype.npm = originalNpm; }
});

test('source-specific add skips source selection, tracks the right provider, and reveals overview', async () => {
  const originalExtension = Providers.prototype.extension;
  Providers.prototype.extension = async p => { assert.equal(p.source, 'openvsx'); return { kind: 'count', label: 'Downloads', value: 42 }; };
  const ui = harness({ input: 'pub.ext' });
  try {
    await ui.open(); ui.send({ type: 'add', source: 'openvsx' }); await ui.drain();
    assert.equal(ui.sourcePrompts, 0);
    assert.deepEqual(ui.state.get('products'), [{ source: 'openvsx', id: 'pub.ext' }]);
    assert.equal(ui.document.querySelector('#view-overview').hidden, false);
    ui.send({ type: 'add', source: 'unexpected' }); await ui.drain();
    assert.match(ui.latest.notice, /Invalid product source/);
    assert.equal(ui.sourcePrompts, 0);
  } finally { ui.close(); Providers.prototype.extension = originalExtension; }
});

test('empty and failed searches for a different account cannot restore the prior dashboard', async () => {
  const originalDiscover = Providers.prototype.discover, originalNpm = Providers.prototype.npm;
  Providers.prototype.discover = async identity => {
    if (identity === 'offline') throw new Error('Network unavailable');
    return { packages: identity === 'empty' ? [] : [{ name: `${identity}-pkg`, description: identity }], note: 'Fixture search' };
  };
  Providers.prototype.npm = fixtureNpm;
  const ui = harness();
  try {
    await ui.open(); await ui.search('alice'); await ui.select(['alice-pkg']);
    await ui.search('empty');
    assert.deepEqual(ui.latest.products, []); assert.deepEqual(ui.latest.readings, []);
    assert.match(ui.document.querySelector('.package-list').textContent, /No public packages/);
    await ui.search('carol'); await ui.select(['carol-pkg']); await ui.search('offline');
    assert.deepEqual(ui.latest.products, []); assert.deepEqual(ui.latest.readings, []); assert.equal(ui.latest.discovery, undefined);
    assert.match(ui.document.body.textContent, /Network unavailable/);
    assert.doesNotMatch(ui.document.querySelector('.cards').textContent, /carol-pkg|alice-pkg/);
    assert.equal(ui.state.get('npmDiscoveryIdentity'), 'username:offline');
    assert.equal(ui.settings.get('npmUsername'), 'offline');
    assert.deepEqual(ui.state.get('products'), []);
  } finally { ui.close(); Providers.prototype.discover = originalDiscover; Providers.prototype.npm = originalNpm; }
});

test('same account and reopening preserve tracking; switching to a scope clears npm only; invalid input keeps current data', async () => {
  const originalDiscover = Providers.prototype.discover, originalNpm = Providers.prototype.npm, originalExtension = Providers.prototype.extension;
  Providers.prototype.discover = async (identity, scope) => ({ packages: [{ name: scope ? `@${identity}/pkg` : `${identity}-pkg`, description: identity }], note: 'Fixture search' });
  Providers.prototype.npm = fixtureNpm;
  Providers.prototype.extension = async () => ({ kind: 'count', label: 'Cumulative downloads', value: 12 });
  const other: Product = { source: 'openvsx', id: 'pub.ext' };
  const ui = harness({ products: [{ source: 'npm', id: 'alice-pkg' }, other], settings: { npmUsername: 'Alice' } });
  let reopened: ReturnType<typeof harness> | undefined;
  try {
    await ui.open(); // Covers upgrading from settings-only identity storage.
    await ui.search(' ALICE ');
    assert.deepEqual(ui.latest.products, [{ source: 'npm', id: 'alice-pkg' }, other]);
    assert.equal(ui.latest.readings.length, 2);
    await ui.search('alice', true);
    assert.deepEqual(ui.latest.products, [other]); assert.equal(ui.latest.readings.length, 1);
    assert.ok(ui.latest.history.length > 0);
    assert.ok(ui.latest.history.every((s: any) => s.product.source === 'openvsx'), 'Account switch removes only npm history');
    await ui.select(['@alice/pkg']);
    const expected = [other, { source: 'npm', id: '@alice/pkg' }];
    await ui.search('invalid user');
    assert.deepEqual(ui.latest.products, expected, 'Invalid input must not discard valid tracking');
    const persisted = { products: ui.state.get('products') as Product[], identityKey: ui.state.get('npmDiscoveryIdentity') as string,
      settings: { npmUsername: ui.settings.get('npmUsername') as string, npmScope: ui.settings.get('npmScope') as string } };
    ui.close();
    reopened = harness(persisted); await reopened.open();
    assert.deepEqual(reopened.latest.products, expected);
    assert.equal(reopened.latest.discoveryKey, 'scope:alice');
    assert.equal(reopened.document.querySelector('[type="checkbox"]').checked, true);
  } finally { if (reopened) reopened.close(); else ui.close(); Providers.prototype.discover = originalDiscover; Providers.prototype.npm = originalNpm; Providers.prototype.extension = originalExtension; }
});

test('saved history survives restart and provider failure, cache hits do not duplicate it, and CSV uses the selected destination', async () => {
  const original = Providers.prototype.extension;
  const p: Product = { source: 'openvsx', id: 'pub.ext' };
  Providers.prototype.extension = async () => ({ kind: 'count', value: 42, label: 'Downloads' });
  const ui = harness({ products: [p] });
  let reopened: ReturnType<typeof harness> | undefined;
  try {
    await ui.open();
    assert.equal(ui.latest.history.length, 1);
    assert.equal(ui.latest.readings[0].health, 'fresh');
    ui.send({ type: 'refresh' }); await ui.drain();
    assert.equal(ui.latest.history.length, 1); assert.equal(ui.latest.readings[0].health, 'cached');
    const exportButton = [...ui.document.querySelectorAll('button')].find((b: any) => b.textContent === 'Export CSV') as any;
    assert.equal(exportButton.disabled, false); exportButton.click(); await ui.drain();
    assert.equal(ui.writes.length, 1); assert.deepEqual(ui.writes[0]!.uri, { path: '/selected/history.csv' });
    assert.match(ui.writes[0]!.text, /"openvsx","pub.ext"/); assert.match(ui.latest.notice, /Exported 1 saved/);
    const history = JSON.parse(JSON.stringify(ui.state.get('history.v1')));
    ui.close(); Providers.prototype.extension = async () => { throw new Error('Provider offline'); };
    reopened = harness({ products: [p], history }); await reopened.open();
    assert.equal(reopened.latest.history.length, 1); assert.equal(reopened.latest.readings[0].health, 'error');
    assert.match(reopened.document.querySelector('.observation-history').textContent, /42/);
    reopened.send({ type: 'export' }); await reopened.drain(); assert.equal(reopened.writes.length, 1);
    reopened.send({ type: 'remove', key: 'openvsx:pub.ext' }); await reopened.drain();
    assert.deepEqual(reopened.state.get('history.v1'), []);
  } finally { reopened?.close(); ui.close(); Providers.prototype.extension = original; }
});

test('CSV cancellation, empty history and write failures do not claim export success', async () => {
  const original = Providers.prototype.extension;
  Providers.prototype.extension = async () => ({ kind: 'count', value: 0, label: 'Downloads' });
  const p: Product = { source: 'openvsx', id: 'pub.ext' };
  for (const options of [{}, { products: [p], cancelExport: true }, { products: [p], failExport: true }]) {
    const ui = harness(options);
    try {
      await ui.open(); ui.send({ type: 'export' }); await ui.drain();
      assert.equal(ui.writes.length, 0); assert.doesNotMatch(ui.latest.notice, /Exported/);
      if (!('products' in options)) { assert.equal(ui.saveDialogs, 0); assert.match(ui.latest.notice, /No saved observations/); }
      if ('failExport' in options) assert.match(ui.latest.notice, /permission denied/);
    } finally { ui.close(); }
  }
  Providers.prototype.extension = original;
});

test('a persistence failure keeps previously saved history and surfaces an error', async () => {
  const original = Providers.prototype.extension;
  Providers.prototype.extension = async () => ({ kind: 'count', value: 42, label: 'Downloads' });
  const p: Product = { source: 'openvsx', id: 'pub.ext' };
  const history = [{ product: p, fetchedAt: new Date(Date.now() - 3600000).toISOString(), metric: { kind: 'count', value: 10 } }];
  const options = { products: [p], history, failHistoryWrite: true };
  const ui = harness(options);
  try {
    await ui.open(); assert.match(ui.latest.notice, /History storage unavailable/);
    assert.equal(ui.latest.readings[0].metric.value, 42);
    assert.deepEqual(ui.latest.history, history); assert.deepEqual(ui.state.get('history.v1'), history);
    options.failHistoryWrite = false;
    ui.send({ type: 'refresh' }); await ui.drain();
    assert.equal(ui.latest.readings[0].health, 'cached');
    assert.equal(ui.latest.history.length, 2, 'Retry persists the unsaved observation even on a cache hit');
    assert.equal((ui.state.get('history.v1') as unknown[]).length, 2);
  } finally { ui.close(); Providers.prototype.extension = original; }
});

test('insights editors persist groups and releases, compare actual readings, and prune removed members across restart', async () => {
  const originalNpm = Providers.prototype.npm, originalExtension = Providers.prototype.extension;
  Providers.prototype.npm = fixtureNpm; Providers.prototype.extension = async () => ({kind:'count',value:42,label:'Downloads'});
  const products: Product[] = [{source:'npm',id:'react'},{source:'npm',id:'other'},{source:'openvsx',id:'pub.ext'}];
  const ui=harness({products}); let reopened: ReturnType<typeof harness> | undefined;
  try {
    await ui.open(); ui.document.querySelector('[aria-controls="view-insights"]').click();
    const name=ui.document.querySelector('[aria-label="Group name"]'); name.value='My product';
    for(const checkbox of ui.document.querySelectorAll('.group-members input')) if(checkbox.value!=='npm:other') {checkbox.checked=true; checkbox.dispatchEvent(new ui.document.defaultView.Event('change'));}
    ui.document.querySelector('.insight-form').dispatchEvent(new ui.document.defaultView.Event('submit',{cancelable:true})); await ui.drain();
    const group=ui.latest.insights.groups[0]; assert.deepEqual(group.keys,['npm:react','openvsx:pub.ext']);
    assert.equal(ui.latest.history.length,3,'Metadata changes do not fabricate observations');
    const filter=ui.document.querySelector('[aria-label="Product group filter"]'); filter.value=group.id; filter.dispatchEvent(new ui.document.defaultView.Event('change'));
    assert.equal(ui.document.querySelector('.summary-total').textContent,'30'); assert.equal(ui.document.querySelectorAll('.product').length,2);
    const date=dateAt(new Date(),-1);
    ui.document.querySelector('[aria-label="Release product"]').value='npm:react';
    ui.document.querySelector('[aria-label="Release date (UTC)"]').value=date;
    ui.document.querySelector('[aria-label="Release label"]').value='v0.5.0';
    ui.document.querySelectorAll('.insight-form')[1].dispatchEvent(new ui.document.defaultView.Event('submit',{cancelable:true})); await ui.drain();
    assert.equal(ui.latest.insights.markers.length,1); assert.ok(ui.document.querySelectorAll('.release-marker').length>=1);
    const target=ui.document.querySelector('[aria-label="Comparison target"]'); target.value=`group:${group.id}`;
    ui.document.querySelector('.comparison-form').dispatchEvent(new ui.document.defaultView.Event('submit',{cancelable:true})); await ui.drain();
    assert.equal(ui.latest.comparison.rows.length,2); assert.deepEqual(ui.latest.comparison.npmTotals,{a:7,b:7,products:1});
    assert.match(ui.document.querySelector('.comparison-result').textContent,/My product/);
    ui.send({type:'refresh'}); await ui.drain(); assert.equal(ui.latest.comparison,undefined,'Data refresh invalidates a previous comparison');
    ui.send({type:'remove',key:'npm:react'}); await ui.drain();
    assert.deepEqual(ui.latest.insights.groups[0].keys,['openvsx:pub.ext']); assert.deepEqual(ui.latest.insights.markers,[]);
    const insights=JSON.parse(JSON.stringify(ui.state.get('insights.v1'))), history=JSON.parse(JSON.stringify(ui.state.get('history.v1')));
    ui.close(); reopened=harness({products:ui.state.get('products') as Product[],insights,history}); await reopened.open();
    assert.deepEqual(reopened.latest.insights,insights); assert.equal(reopened.latest.products.length,2);
  } finally {ui.close(); reopened?.close(); Providers.prototype.npm=originalNpm; Providers.prototype.extension=originalExtension;}
});

test('insights reject malformed bridge requests, preserve stored metadata on write failure, and clear invalid comparisons', async () => {
  const original=Providers.prototype.npm; Providers.prototype.npm=fixtureNpm;
  const insights={groups:[{id:'g_existing',name:'Existing',keys:['npm:react']}],markers:[]};
  const options={products:[{source:'npm',id:'react'} as Product],insights,failInsightsWrite:true};
  const ui=harness(options);
  try {
    await ui.open(); ui.send({type:'groupSave',group:{id:'g_existing',name:'Renamed',keys:['npm:react']}}); await ui.drain();
    assert.match(ui.latest.notice,/Insights storage unavailable/); assert.deepEqual(ui.latest.insights,insights); assert.deepEqual(ui.state.get('insights.v1'),insights);
    options.failInsightsWrite=false;
    ui.send({type:'groupSave',group:{name:'Bad',keys:['npm:untracked']}}); await ui.drain(); assert.match(ui.latest.notice,/currently tracked/);
    const end=dateAt(new Date(),-1), start=dateAt(new Date(),-7);
    const request={target:'all',a:{start,end},b:{start,end}};
    ui.send({type:'compare',request}); await ui.drain(); assert.ok(ui.latest.comparison);
    ui.send({type:'compare',request:{...request,a:{start:'2026-02-30',end}}}); await ui.drain();
    assert.equal(ui.latest.comparison,undefined); assert.match(ui.latest.notice,/valid UTC date/);
    ui.send({type:'markerSave',marker:{key:'npm:unknown',label:'v1',date:end}}); await ui.drain(); assert.match(ui.latest.notice,/tracked product/);
    ui.send({type:'groupDelete',id:'g_existing'}); await ui.drain(); assert.equal(ui.latest.insights.groups.length,0); assert.equal(ui.latest.products.length,1);
  } finally {ui.close(); Providers.prototype.npm=original;}
});

test('monitoring milestones persist once across cached refreshes/restarts and support reading and pruning alerts', async () => {
  const original=Providers.prototype.extension; Providers.prototype.extension=async()=>({kind:'count',value:100,label:'Downloads'});
  const p: Product={source:'openvsx',id:'pub.ext'};
  const monitoring={rules:[{id:'m_goal',key:'openvsx:pub.ext',name:'100 downloads',metric:'count',kind:'milestone',threshold:100,enabled:true,lastValue:50,lastSampleAt:new Date(Date.now()-3600000).toISOString(),reached:false}],alerts:[]};
  const ui=harness({products:[p],monitoring}); let reopened:ReturnType<typeof harness>|undefined;
  try {
    await ui.open(); assert.equal(ui.latest.monitoring.alerts.length,1); assert.equal(ui.latest.monitoring.rules[0].reached,true);
    ui.send({type:'refresh'}); await ui.drain(); assert.equal(ui.latest.monitoring.alerts.length,1);
    ui.document.querySelector('[aria-controls="view-launch"]').click();
    const button=[...ui.document.querySelectorAll('button')].find((b:any)=>b.textContent==='Mark all alerts read') as any; button.click(); await ui.drain();
    assert.equal(ui.latest.monitoring.alerts[0].acknowledged,true);
    const saved=JSON.parse(JSON.stringify(ui.state.get('monitor.v1'))); ui.close(); reopened=harness({products:[p],monitoring:saved}); await reopened.open();
    assert.equal(reopened.latest.monitoring.alerts.length,1); assert.equal(reopened.latest.monitoring.rules[0].reached,true);
    reopened.send({type:'remove',key:'openvsx:pub.ext'}); await reopened.drain(); assert.deepEqual(reopened.latest.monitoring,{rules:[],alerts:[]});
  } finally {ui.close(); reopened?.close(); Providers.prototype.extension=original;}
});

test('monitoring persistence failure retains a pending alert and commits it on a cached retry without duplicates', async () => {
  const original=Providers.prototype.extension; let calls=0; Providers.prototype.extension=async()=>{calls++;return {kind:'count',value:100,label:'Downloads'};};
  const monitoring={rules:[{id:'m_goal',key:'openvsx:pub.ext',name:'Goal',metric:'count',kind:'milestone',threshold:100,enabled:true}],alerts:[]};
  const options={products:[{source:'openvsx',id:'pub.ext'} as Product],monitoring,failMonitorWrite:true}; const ui=harness(options);
  try {
    await ui.open(); assert.match(ui.latest.notice,/Monitoring storage unavailable/); assert.equal(ui.latest.monitoring.alerts.length,0); assert.deepEqual(ui.state.get('monitor.v1'),monitoring);
    options.failMonitorWrite=false; ui.send({type:'refresh'}); await ui.drain(); assert.equal(calls,1); assert.equal(ui.latest.monitoring.alerts.length,1);
    ui.send({type:'refresh'}); await ui.drain(); assert.equal(ui.latest.monitoring.alerts.length,1);
    ui.send({type:'ruleSave',rule:{name:'Fresh goal',key:'openvsx:pub.ext',metric:'count',kind:'milestone',threshold:200,enabled:true}}); await ui.drain();
    const rule=ui.latest.monitoring.rules.find((r:any)=>r.name==='Fresh goal'); assert.equal(rule.lastValue,100);
    ui.send({type:'ruleSave',rule:{...rule,threshold:300}}); await ui.drain(); assert.equal(ui.latest.monitoring.rules.length,2);
    ui.send({type:'ruleSave',rule:{name:'Fresh goal',key:'openvsx:pub.ext',metric:'count',kind:'milestone',threshold:200,enabled:true}}); await ui.drain(); assert.match(ui.latest.notice,/unique rule name/);
  } finally {ui.close(); Providers.prototype.extension=original;}
});

test('launch review validation errors reach the report area and clear after a successful retry or refresh', async () => {
  const original=Providers.prototype.npm; Providers.prototype.npm=fixtureNpm;
  const today=new Date().toISOString().slice(0,10);
  const older=new Date(Date.now()-21*86400000).toISOString().slice(0,10);
  const insights={groups:[],markers:[{id:'r_old',key:'npm:react',date:older,label:'Older'},{id:'r_today',key:'npm:react',date:today,label:'Today'}]};
  const ui=harness({products:[{source:'npm',id:'react'}],insights});
  try {
    await ui.open(); const request={markerId:'r_today',target:'product:npm:react',days:7};
    ui.send({type:'launchReview',request}); await ui.drain();
    assert.deepEqual(ui.latest.launchReviewError.request,request); assert.match(ui.latest.launchReviewError.message,/full after-launch window ends/); assert.equal(ui.latest.launchReport,undefined);
    ui.send({type:'launchReview',request:{...request,markerId:'r_old'}}); await ui.drain();
    assert.equal(ui.latest.launchReviewError,undefined); assert.equal(ui.latest.launchReport.marker.id,'r_old');
    ui.send({type:'launchReview',request}); await ui.drain(); assert.ok(ui.latest.launchReviewError);
    ui.send({type:'refresh'}); await ui.drain(); assert.equal(ui.latest.launchReviewError,undefined);
  } finally {ui.close(); Providers.prototype.npm=original;}
});

test('early launch reports preserve notes across restart, preview the export SVG and retain preliminary labels', async () => {
  const original=Providers.prototype.npm; Providers.prototype.npm=fixtureNpm;
  const marker={id:'r_early',key:'npm:react',date:dateAt(new Date(),-3),label:'v1',notes:'Fixed startup'};
  const ui=harness({products:[{source:'npm',id:'react'}],insights:{groups:[],markers:[marker]}});
  let reopened: ReturnType<typeof harness>|undefined;
  try {
    await ui.open(); ui.send({type:'launchReview',request:{markerId:marker.id,target:'all',days:7,mode:'early'}}); await ui.drain();
    assert.equal(ui.latest.launchReport.preliminary,true); assert.equal(ui.latest.launchReport.actualDays,3); assert.equal(ui.latest.launchReport.marker.notes,marker.notes);
    ui.send({type:'launchPreview',requestId:'preview-1',metric:'npm-total'}); await ui.drain();
    const preview=ui.posted.filter((m:any)=>m.type==='launchPreview').at(-1); assert.equal(preview.requestId,'preview-1'); assert.match(preview.svg,/PRELIMINARY/);
    ui.send({type:'launchExport',format:'svg',metric:'npm-total'}); await ui.drain(); assert.equal(ui.writes.at(-1)!.text,preview.svg);
    ui.send({type:'launchExport',format:'md'}); await ui.drain(); assert.match(ui.writes.at(-1)!.text,/PRELIMINARY/);
    ui.send({type:'markerSave',marker:{...marker,notes:'Less waiting'}}); await ui.drain();
    ui.send({type:'launchPreview',requestId:'expired',metric:'npm-total'}); await ui.drain(); assert.match(ui.latest.notice,/Generate a launch report/);
    reopened=harness({products:ui.latest.products,insights:ui.state.get('insights.v1')}); await reopened.open(); assert.equal(reopened.latest.insights.markers[0].notes,'Less waiting');
  } finally {ui.close();reopened?.close();Providers.prototype.npm=original;}
});

test('launch review exports Markdown, SVG and validated PNG; stale/replayed and malformed PNG requests cannot write files', async () => {
  const original=Providers.prototype.npm; Providers.prototype.npm=fixtureNpm;
  const insights={groups:[],markers:[{id:'r_launch',key:'npm:react',date:dateAt(new Date(),-14),label:'v0.6'}]};
  const ui=harness({products:[{source:'npm',id:'react'}],insights});
  const click=(text:string)=>{const b=[...ui.document.querySelectorAll('button')].find((b:any)=>b.textContent===text) as any; assert.ok(b); b.click();};
  try {
    await ui.open(); ui.document.querySelector('[aria-controls="view-launch"]').click();
    ui.document.querySelector('.launch-form').dispatchEvent(new ui.document.defaultView.Event('submit',{cancelable:true})); await ui.drain();
    assert.equal(ui.latest.launchReport.days,7); assert.equal(ui.latest.launchReport.comparison.npmTotals.a,7);
    click('Export report (Markdown)'); await ui.drain(); assert.match(ui.writes[0]!.text,/# Launch Review/); assert.deepEqual(ui.saveOptions[0].filters,{'Markdown report':['md']});
    click('Export card (SVG)'); await ui.drain(); assert.match(ui.writes[1]!.text,/width="1200" height="630"/); assert.match(ui.writes[1]!.text,/Daily npm downloads/);
    click('Export card (PNG)'); await ui.drain(); const request=ui.posted.filter((m:any)=>m.type==='renderShareCard').at(-1); assert.ok(request.requestId); assert.match(request.svg,/Timing does not establish causation/);
    const png=cardPng(); ui.send({type:'saveShareCard',requestId:request.requestId,data:png.toString('base64')}); await ui.drain();
    assert.deepEqual(ui.writes[2]!.bytes,png); assert.deepEqual(ui.saveOptions[2].filters,{'Share card':['png']});
    ui.send({type:'saveShareCard',requestId:request.requestId,data:png.toString('base64')}); await ui.drain(); assert.equal(ui.writes.length,3); assert.match(ui.latest.notice,/expired/);
    ui.send({type:'launchShare',metric:'npm-total'}); await ui.drain(); const bad=ui.posted.filter((m:any)=>m.type==='renderShareCard').at(-1);
    ui.send({type:'saveShareCard',requestId:bad.requestId,data:'bad'}); await ui.drain(); assert.equal(ui.writes.length,3); assert.match(ui.latest.notice,/PNG/);
    ui.send({type:'launchShare',metric:'npm-total'}); await ui.drain(); const stale=ui.posted.filter((m:any)=>m.type==='renderShareCard').at(-1);
    ui.send({type:'refresh'}); await ui.drain(); assert.equal(ui.latest.launchReport,undefined);
    ui.send({type:'saveShareCard',requestId:stale.requestId,data:png.toString('base64')}); await ui.drain(); assert.equal(ui.writes.length,3);
  } finally {ui.close(); Providers.prototype.npm=original;}
});

test('launch export cancellation and write failures report no success, and PNG renderer errors allow SVG fallback', async () => {
  const original=Providers.prototype.npm; Providers.prototype.npm=fixtureNpm;
  const insights={groups:[],markers:[{id:'r_launch',key:'npm:react',date:dateAt(new Date(),-14),label:'v0.6'}]};
  try {
    for(const extra of [{cancelExport:true},{failExport:true}]) {
      const ui=harness({products:[{source:'npm',id:'react'}],insights,...extra});
      try {
        await ui.open(); ui.send({type:'launchReview',request:{markerId:'r_launch',target:'all',days:7}}); await ui.drain();
        ui.send({type:'launchExport',format:'md'}); await ui.drain(); assert.equal(ui.writes.length,0); assert.doesNotMatch(ui.latest.notice,/exported/);
        if('failExport' in extra) assert.match(ui.latest.notice,/permission denied/);
        ui.send({type:'launchShare',metric:'npm-total'}); await ui.drain(); const request=ui.posted.filter((m:any)=>m.type==='renderShareCard').at(-1);
        ui.send({type:'shareCardError',requestId:request.requestId}); await ui.drain(); assert.match(ui.latest.notice,/Export the SVG/);
      } finally {ui.close();}
    }
  } finally {Providers.prototype.npm=original;}
});

test('clearing Reddit credentials also removes Reddit monitoring rules and historical alerts', async () => {
  const product: Product={source:'reddit',id:'abc123'}, at=new Date(Date.now()-3600000).toISOString();
  const monitoring={rules:[{id:'m_reddit',key:'reddit:abc123',name:'Comments',metric:'count',kind:'milestone',threshold:10,enabled:true}],alerts:[{id:'a_reddit',ruleId:'m_reddit',key:'reddit:abc123',name:'Comments',metric:'count',kind:'milestone',threshold:10,value:10,createdAt:at,acknowledged:false}]};
  const ui=harness({products:[product],monitoring});
  try {await ui.open(); assert.equal(ui.latest.monitoring.rules.length,1); ui.send({type:'clearToken'}); await ui.drain(); assert.deepEqual(ui.latest.monitoring,{rules:[],alerts:[]}); assert.deepEqual(ui.state.get('monitor.v1'),{rules:[],alerts:[]});} finally {ui.close();}
});
