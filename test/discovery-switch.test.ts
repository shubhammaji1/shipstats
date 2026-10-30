import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Providers } from '../src/providers';
import { dateAt, windows, Day, Product } from '../src/model';
const { JSDOM } = require('jsdom');
const Module = require('node:module');

// Run the real extension controller and dashboard together, replacing only VS Code
// services and network providers. Message ordering and persistence remain real.
function harness(initial: { products?: Product[]; settings?: Record<string, string>; identityKey?: string; input?: string } = {}) {
  const state = new Map<string, unknown>(), settings = new Map<string, unknown>(Object.entries(initial.settings ?? {}));
  if (initial.products) state.set('products', initial.products);
  if (initial.identityKey) state.set('npmDiscoveryIdentity', initial.identityKey);
  const commands = new Map<string, () => Promise<void>>(), posted: any[] = [];
  let receive: (m: unknown) => void, dom: any, sourcePrompts = 0;
  class EventEmitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
  const disposable = () => ({ dispose() {} });
  const vscode = {
    EventEmitter, TreeItem: class { constructor(public label: string) {} },
    StatusBarAlignment: { Left: 1 }, ViewColumn: { One: 1 }, ConfigurationTarget: { Global: 1 },
    Uri: { joinPath: (base: any, ...parts: string[]) => ({ path: join(base.path, ...parts), toString() { return this.path; } }) },
    workspace: {
      getConfiguration: () => ({ get: (key: string, fallback: unknown) => settings.get(key) ?? fallback,
        update: async (key: string, value: unknown) => { settings.set(key, value); } }),
      onDidChangeConfiguration: disposable
    },
    commands: { registerCommand: (id: string, fn: () => Promise<void>) => { commands.set(id, fn); return disposable(); } },
    window: {
      registerTreeDataProvider: disposable,
      createStatusBarItem: () => ({ ...disposable(), show() {} }),
      showErrorMessage: async () => {},
      showQuickPick: async (options: unknown[]) => { sourcePrompts++; return options[0]; },
      showInputBox: async () => initial.input,
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
    globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } },
    secrets: { get: async () => undefined } };
  const originalLoad = Module._load;
  try {
    Module._load = function(id: string, ...args: unknown[]) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
    delete require.cache[require.resolve('../src/extension')];
    require('../src/extension').activate(context);
  } finally { Module._load = originalLoad; }
  const app = context.subscriptions[0];
  const drain = (): Promise<void> => app.queue;
  return {
    state, settings, posted, drain,
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
