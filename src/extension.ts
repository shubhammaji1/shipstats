import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Analytics, parallelMap } from './service';
import { History, Snapshot, historyCsv, readingHealth } from './history';
import { Comparison, Insights, compare, deleteInsight, restoreInsights, saveGroup, saveMarker } from './insights';
import { LaunchReport, MonitorState, acknowledgeAlerts, deleteRule, evaluateRules, launchMarkdown, launchReview, restoreMonitor, saveRule, shareCard, validateCardPng } from './launch';
import { Providers } from './providers';
import { CollectorLease } from './collector';
import { Backup, BACKUP_BYTES, makeBackup, parseBackup, storageHealth, inspectLaunch, currentValue, currentShareCard, progressSummary } from './upgrade';
import { Discovery, Product, Reading, Source, dateAt, discoveryIdentity, errorMessage, keyOf, product, restoreProducts, selectedPackages, sourceUrl } from './model';

const TOKEN = 'shipstats.reddit.accessToken';
const HISTORY = 'history.v1';
const INSIGHTS = 'insights.v1';
const MONITOR = 'monitor.v1';
const RESTORE_JOURNAL = 'restore.pending.v1';
const COLLECTION = 'collection.v1';
export function activate(context: vscode.ExtensionContext): void {
  const app = new ShipStats(context);
  context.subscriptions.push(app);
  for (const [id, fn] of Object.entries({
    open: () => app.open(), discover: () => app.chooseIdentity(), add: () => app.add(),
    refresh: () => app.refresh(), exportCsv: () => app.exportCsv(), redditToken: () => app.setToken(), clearRedditToken: () => app.clearToken()
  })) context.subscriptions.push(vscode.commands.registerCommand(`shipstats.${id}`, () => app.run(async () => { await fn(); })));
}

class ProductsTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private getProducts: () => Product[]) {}
  refresh(): void { this.emitter.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(): vscode.TreeItem[] {
    const products = this.getProducts();
    return (products.length ? products.map(p => ({ label: p.id, description: p.source })) : [{ label: 'Discover your npm packages', description: 'Get started' }]).map(p => {
      const item = new vscode.TreeItem(p.label); item.description = p.description;
      item.command = { command: 'shipstats.open', title: 'Open Dashboard' }; return item;
    });
  }
  dispose(): void { this.emitter.dispose(); }
}

class ShipStats implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private products: Product[];
  private readings: Reading[] = [];
  private history: History;
  private pendingHistory: Snapshot[] = [];
  private insights: Insights;
  private comparison?: Comparison;
  private launchReport?: LaunchReport;
  private launchReviewError?: { request: unknown; message: string };
  private monitoring: MonitorState;
  private pendingMonitoring?: MonitorState;
  private pendingShare?: string;
  private backgroundTimer?: ReturnType<typeof setInterval>;
  private collectorLease: CollectorLease;
  private initialized: Promise<void>;
  private restoreError = '';
  private pendingBackup?: { data: Backup; id: string };
  private releaseSuggestions?: { key: string; candidates: {version:string;date:string;publishedAt:string}[] };
  private collection: { lastAttemptAt?: string; lastSuccessAt?: string; error?: string; successfulProducts?: number };
  private discovery?: Discovery;
  private discoveryKey?: string;
  private busy = false;
  private notice = '';
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private providers = new Providers();
  private analytics = new Analytics(this.providers);
  private tree: ProductsTree;
  private disposables: vscode.Disposable[] = [];
  constructor(private context: vscode.ExtensionContext) {
    this.collectorLease=new CollectorLease(context.globalStorageUri?.fsPath);
    // A retained journal means an earlier restore was interrupted. Display the old
    // state and repair storage before accepting actions or collecting new samples.
    const journal = context.globalState.get<Backup>(RESTORE_JOURNAL);
    const saved = (key: string): unknown => journal?.type === 'shipstats-backup' ? ({products:journal.products,[HISTORY]:journal.history,[INSIGHTS]:journal.insights,[MONITOR]:journal.monitoring} as Record<string,unknown>)[key] : context.globalState.get(key);
    this.products = restoreProducts(saved('products'));
    this.history = new History(saved(HISTORY), this.products);
    this.insights = restoreInsights(saved(INSIGHTS), this.products);
    this.monitoring = restoreMonitor(saved(MONITOR), this.products);
    const status = context.globalState.get<Record<string,unknown>>(COLLECTION);
    const savedTime = (v:unknown) => typeof v==='string' && Number.isFinite(Date.parse(v)) && Date.parse(v)<=Date.now() ? v : undefined;
    this.collection = { lastAttemptAt:savedTime(status?.lastAttemptAt),lastSuccessAt:savedTime(status?.lastSuccessAt),error:typeof status?.error==='string'?status.error.slice(0,500):undefined,
      successfulProducts:typeof status?.successfulProducts==='number'&&Number.isInteger(status.successfulProducts)&&status.successfulProducts>=0&&status.successfulProducts<=50?status.successfulProducts:undefined };
    this.initialized = this.recoverRestore(journal);
    this.discoveryKey = context.globalState.get<string>('npmDiscoveryIdentity');
    if (!this.discoveryKey) {
      // Older builds stored the identity only in settings. Preserve that account's
      // selection on upgrade; a genuinely different search still clears it.
      const scope = this.config().get<string>('npmScope', '').trim();
      const username = this.config().get<string>('npmUsername', '').trim();
      if (scope || username) {
        try { this.discoveryKey = `${scope ? 'scope' : 'username'}:${discoveryIdentity(scope || username, !!scope)}`; }
        catch { /* Invalid settings will be reported when discovery is requested. */ }
      }
    }
    this.tree = new ProductsTree(() => this.products);
    this.disposables.push(this.tree, vscode.window.registerTreeDataProvider('shipstats.products', this.tree));
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    statusBar.text = '$(graph) ShipStats'; statusBar.command = 'shipstats.open'; statusBar.tooltip = 'Open developer product analytics'; statusBar.show();
    this.disposables.push(statusBar, vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('shipstats')) {
        this.analytics.clearReddit(); this.schedule(); this.send();
      }
    }));
    this.schedule();
    if (this.config().get<boolean>('backgroundCollection',false) && this.products.length) void this.run(()=>this.collectInBackground(),true);
  }
  private config(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration('shipstats'); }
  private async collectInBackground(): Promise<void> {
    if(this.disposed || !this.config().get<boolean>('backgroundCollection',false))return;
    if(!await this.collectorLease.acquire()){this.notice='Another VS Code window owns background collection for this profile. Manual refresh remains available.';return;}
    if(this.disposed || !this.config().get<boolean>('backgroundCollection',false)){await this.collectorLease.release();return;}
    await this.refresh();
  }
  private async writeBackupState(data: Backup): Promise<void> {
    for (const [key,value] of Object.entries({products:data.products,[HISTORY]:data.history,[INSIGHTS]:data.insights,[MONITOR]:data.monitoring})) await this.context.globalState.update(key,value);
  }
  private async recoverRestore(journal: unknown): Promise<void> {
    if (journal === undefined) return;
    try { const data=parseBackup(JSON.stringify(journal)); await this.writeBackupState(data); await this.context.globalState.update(RESTORE_JOURNAL,undefined); }
    catch { this.restoreError='An interrupted backup restore could not be recovered. Existing data has been retained; resolve the local storage error and reload VS Code.'; }
  }
  private async exportBackup(): Promise<void> {
    const data=makeBackup(this.products,this.history.entries(),this.insights,this.monitoring);
    const uri=await vscode.window.showSaveDialog({title:'Export ShipStats backup (no credentials)',defaultUri:vscode.Uri.file(join(homedir(),`shipstats-backup-${dateAt(new Date(),0)}.json`)),filters:{'ShipStats backup':['json']}});
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri,Buffer.from(JSON.stringify(data,null,2),'utf8'));this.notice='Backup exported. It contains product identifiers and saved metrics, without credentials or settings.';
  }
  private async inspectBackup(): Promise<void> {
    this.pendingBackup=undefined;
    const uris=await vscode.window.showOpenDialog({title:'Review a ShipStats backup',canSelectMany:false,filters:{'ShipStats backup':['json']}});
    if (!uris?.[0]) return;
    if ((await vscode.workspace.fs.stat(uris[0])).size>BACKUP_BYTES) throw new Error('Backup exceeds the 5 MB limit.');
    const bytes=await vscode.workspace.fs.readFile(uris[0]);if(bytes.byteLength>BACKUP_BYTES)throw new Error('Backup exceeds the 5 MB limit.');
    this.pendingBackup={data:parseBackup(Buffer.from(bytes).toString('utf8')),id:randomUUID()};
    this.notice='Backup checked. Review its contents and replacement notice in Health & progress before restoring.';
  }
  private async restoreBackup(id: unknown): Promise<void> {
    if (!this.pendingBackup || id!==this.pendingBackup.id) throw new Error('Review a backup file before restoring.');
    const data=this.pendingBackup.data, old=makeBackup(this.products,this.history.entries(),this.insights,this.monitoring);
    // Journal is written first. If a write fails or the host exits, the next
    // activation repairs all four keys from the old validated state.
    await this.context.globalState.update(RESTORE_JOURNAL,old);
    try { await this.writeBackupState(data); await this.context.globalState.update(RESTORE_JOURNAL,undefined); }
    catch (error) {
      try { await this.writeBackupState(old); await this.context.globalState.update(RESTORE_JOURNAL,undefined); }
      catch { this.restoreError='Backup restore was interrupted. Reload VS Code after resolving the local storage error to recover the previous data.'; }
      throw error;
    }
    this.products=data.products;this.history=new History(data.history,data.products);this.insights=data.insights;this.monitoring=data.monitoring;
    this.readings=[];this.analytics=new Analytics(this.providers);this.pendingHistory=[];this.pendingMonitoring=undefined;
    this.discovery=undefined;this.releaseSuggestions=undefined;this.pendingBackup=undefined;
    this.comparison=undefined;this.launchReport=undefined;this.launchReviewError=undefined;this.pendingShare=undefined;this.tree.refresh();
    this.notice='Backup restored. Refresh to fetch current source metrics. Collection settings and credentials were not changed.';
  }
  private cardSvg(message: Record<string,unknown>): string {
    if (message.cardType==='current') return currentShareCard(currentValue(this.products,this.readings,message.key,message.days ?? 30));
    if (message.cardType!==undefined && message.cardType!=='comparison') throw new Error('Choose a current-total or comparison card.');
    if (!this.launchReport) throw new Error('Generate a launch report first.');
    return shareCard(this.launchReport,message.metric);
  }
  run(fn: () => Promise<void>, background = false): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.disposed) return;
      this.busy = true; this.notice = ''; this.send();
      try { await this.initialized; if (this.restoreError) throw new Error(this.restoreError); await fn(); }
      catch (e) {
        this.notice = errorMessage(e);
        if (!this.panel && !background) void vscode.window.showErrorMessage(`ShipStats: ${this.notice}`);
      } finally { this.busy = false; this.send(); }
    });
    return this.queue;
  }
  open(): void {
    if (this.panel) { this.panel.reveal(); return; }
    this.panel = vscode.window.createWebviewPanel('shipstats.dashboard', 'ShipStats', vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    });
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const m = message as Record<string, unknown>;
      if (typeof m.type !== 'string') return;
      if (m.type==='launchInspect') {
        if (typeof m.requestId!=='string' || m.requestId.length>64) return;
        try { const availability=inspectLaunch(m.request,this.products,this.readings,this.history.entries(),this.insights);void this.panel?.webview.postMessage({type:'launchAvailability',requestId:m.requestId,availability}); }
        catch(error) {void this.panel?.webview.postMessage({type:'launchAvailability',requestId:m.requestId,error:errorMessage(error)});}
        return;
      }
      void this.run(async () => {
        switch (m.type) {
          case 'ready': {
            await this.refresh();
            const scope = this.config().get<string>('npmScope', '').trim(), username = this.config().get<string>('npmUsername', '').trim();
            if (scope || username) await this.discover(scope || username, !!scope);
            break;
          }
          case 'discover':
            if (typeof m.identity !== 'string' || typeof m.scope !== 'boolean') throw new Error('Invalid discovery request.');
            await this.discover(m.identity, m.scope); break;
          case 'select':
            if (!Array.isArray(m.names) || m.names.length > 1000 || m.names.some(n => typeof n !== 'string')) throw new Error('Invalid package selection.');
            await this.select(m.names as string[]); break;
          case 'add':
            if (m.source !== undefined && !['npm', 'marketplace', 'openvsx', 'reddit'].includes(m.source as string)) throw new Error('Invalid product source.');
            await this.add(m.source as Source | undefined); break;
          case 'refresh': await this.refresh(); break;
          case 'backupExport': await this.exportBackup(); break;
          case 'backupInspect': await this.inspectBackup(); break;
          case 'backupRestore': await this.restoreBackup(m.id); break;
          case 'backupCancel': this.pendingBackup=undefined; break;
          case 'collectionSave': {
            if (typeof m.enabled!=='boolean' || typeof m.minutes!=='number' || !Number.isInteger(m.minutes) || m.minutes<10 || m.minutes>1440) throw new Error('Choose a collection interval from 10 to 1440 minutes.');
            await this.config().update('collectionMinutes',m.minutes,vscode.ConfigurationTarget.Global);
            await this.config().update('backgroundCollection',m.enabled,vscode.ConfigurationTarget.Global);this.schedule();
            if(m.enabled && this.products.length)await this.collectInBackground();
            this.notice=m.enabled?'Background collection enabled while VS Code runs.':'Background collection disabled.';break;
          }
          case 'releaseDiscover': {
            const p=this.find(m.key);if(p?.source!=='npm')throw new Error('Choose a tracked npm package. Extension release markers can be entered manually.');
            this.releaseSuggestions=undefined;
            this.releaseSuggestions={key:keyOf(p),candidates:await this.providers.releases(p.id)};
            this.notice='Review npm version publication dates before saving markers. No markers were added automatically.';break;
          }
          case 'export': await this.exportCsv(); break;
          case 'groupSave': await this.saveInsights(saveGroup(this.insights, m.group, this.products)); this.notice = 'Product group saved.'; break;
          case 'groupDelete': await this.saveInsights(deleteInsight(this.insights, 'group', m.id)); this.notice = 'Group deleted. Tracked products and release markers remain.'; break;
          case 'markerSave': await this.saveInsights(saveMarker(this.insights, m.marker, this.products)); this.notice = 'Release marker saved.'; break;
          case 'markerDelete': await this.saveInsights(deleteInsight(this.insights, 'marker', m.id)); this.notice = 'Release marker deleted.'; break;
          case 'compare':
            this.comparison = undefined;
            this.comparison = compare(m.request, this.products, this.readings, new History(this.history.entries(), this.products).entries(), this.insights.groups);
            break;
          case 'launchReview':
            this.launchReport = undefined; this.launchReviewError = undefined; this.pendingShare = undefined;
            try {
              this.launchReport = launchReview(m.request, this.products, this.readings, new History(this.history.entries(), this.products).entries(), this.insights);
            } catch (error) {
              this.launchReviewError = { request: m.request, message: errorMessage(error) }; throw error;
            }
            break;
          case 'ruleSave': await this.saveMonitoring(saveRule(this.pendingMonitoring ?? this.monitoring, m.rule, this.products, this.readings)); this.notice = 'Monitoring rule saved. Fresh readings will evaluate it.'; break;
          case 'ruleDelete': await this.saveMonitoring(deleteRule(this.pendingMonitoring ?? this.monitoring, m.id)); this.notice = 'Monitoring rule deleted. Previous alerts remain.'; break;
          case 'alertAck': {
            let next = this.pendingMonitoring ?? this.monitoring;
            if (m.id === 'all') for (const alert of this.monitoring.alerts) next = acknowledgeAlerts(next, alert.id);
            else next = acknowledgeAlerts(next, m.id);
            await this.saveMonitoring(next); this.notice = 'Alerts marked read.'; break;
          }
          case 'launchExport': await this.exportLaunch(m); break;
          case 'launchPreview': {
            if (typeof m.requestId !== 'string' || m.requestId.length > 64) throw new Error('Invalid preview request.');
            const svg = this.cardSvg(m);
            void this.panel?.webview.postMessage({ type: 'launchPreview', requestId: m.requestId, svg });
            break;
          }
          case 'launchShare': {
            const svg = this.cardSvg(m);
            this.pendingShare = randomUUID();
            void this.panel?.webview.postMessage({ type: 'renderShareCard', requestId: this.pendingShare, svg });
            break;
          }
          case 'saveShareCard': {
            if (!this.pendingShare || m.requestId !== this.pendingShare) throw new Error('Share-card request expired. Export again.');
            this.pendingShare = undefined;
            const png = validateCardPng(m.data);
            if (await this.writeLaunchFile('png', png)) this.notice = 'PNG share card exported.';
            break;
          }
          case 'shareCardError':
            if (this.pendingShare && m.requestId === this.pendingShare) { this.pendingShare = undefined; this.notice = 'PNG rendering failed. Export the SVG card instead.'; }
            break;
          case 'remove': {
            const p = this.find(m.key); if (!p) return;
            await this.save(this.products.filter(item => keyOf(item) !== keyOf(p))); break;
          }
          case 'source': { const p = this.find(m.key); if (p) await vscode.env.openExternal(vscode.Uri.parse(sourceUrl(p))); break; }
          case 'token': await this.setToken(); break;
          case 'clearToken': await this.clearToken(); break;
          case 'settings': await vscode.commands.executeCommand('workbench.action.openSettings', 'shipstats'); break;
        }
      });
    });
    this.panel.onDidDispose(() => { this.panel = undefined; if (this.timer) clearInterval(this.timer); this.timer = undefined; });
    this.schedule();
  }
  private find(key: unknown): Product | undefined { return typeof key === 'string' ? this.products.find(p => keyOf(p) === key) : undefined; }
  async chooseIdentity(): Promise<void> {
    this.open();
    const kind = await vscode.window.showQuickPick(['npm username', 'npm scope'], { title: 'Discover public npm packages' });
    if (!kind) return;
    const value = await vscode.window.showInputBox({ title: kind, prompt: 'Search public packages. Results do not establish ownership.', ignoreFocusOut: true });
    if (value !== undefined) {
      await this.discover(value, kind === 'npm scope');
      void this.panel?.webview.postMessage({ type: 'navigate', page: 'packages' });
    }
  }
  private async discover(identity: string, scope: boolean): Promise<void> {
    const normalized = discoveryIdentity(identity, scope);
    const nextKey = `${scope ? 'scope' : 'username'}:${normalized}`;
    if (nextKey !== this.discoveryKey) {
      this.discoveryKey = nextKey;
      this.discovery = undefined;
      // Account changes are a new npm dashboard, including when the new search
      // is empty or fails. Pruning also prevents cached prior-account readings.
      await this.save(this.products.filter(p => p.source !== 'npm'));
    }
    await this.context.globalState.update('npmDiscoveryIdentity', nextKey);
    await this.config().update(scope ? 'npmScope' : 'npmUsername', normalized, vscode.ConfigurationTarget.Global);
    if (!scope) await this.config().update('npmScope', '', vscode.ConfigurationTarget.Global);
    const result = await this.providers.discover(normalized, scope);
    this.discovery = result;
    this.notice = `${result.packages.length} public package matches. Choose the ones you want to track.`;
    this.send();
  }
  private async select(names: string[]): Promise<void> {
    if (!this.discovery) throw new Error('Discover packages first.');
    await this.save(selectedPackages(this.products, this.discovery.packages.map(p => p.name), names));
    await this.refresh();
  }
  private async save(products: Product[]): Promise<void> {
    const unique = [...new Map(products.map(p => [keyOf(p), p])).values()];
    if (unique.length > 50) throw new Error('Track up to 50 products. Remove one before adding another.');
    await this.context.globalState.update('products', unique);
    this.products = unique;
    this.releaseSuggestions=undefined;
    this.comparison = undefined;
    this.launchReport = undefined; this.launchReviewError = undefined; this.pendingShare = undefined;
    this.readings = this.readings.filter(r => unique.some(p => keyOf(p) === keyOf(r.product)));
    this.analytics.prune(unique);
    this.history = new History(this.history.entries(), unique);
    this.pendingHistory = new History(this.pendingHistory, unique).entries();
    this.insights = restoreInsights(this.insights, unique);
    this.monitoring = restoreMonitor(this.monitoring, unique);
    if (this.pendingMonitoring) this.pendingMonitoring = restoreMonitor(this.pendingMonitoring, unique);
    this.tree.refresh(); this.send();
    await this.context.globalState.update(HISTORY, this.history.entries());
    await this.context.globalState.update(INSIGHTS, this.insights);
    await this.context.globalState.update(MONITOR, this.monitoring);
  }
  private async saveInsights(next: Insights): Promise<void> {
    await this.context.globalState.update(INSIGHTS, next);
    this.insights = next;
    this.comparison = undefined;
    this.launchReport = undefined; this.launchReviewError = undefined; this.pendingShare = undefined;
  }
  private async saveMonitoring(next: MonitorState): Promise<void> {
    await this.context.globalState.update(MONITOR, next);
    this.monitoring = next; this.pendingMonitoring = undefined;
  }
  private async writeLaunchFile(extension: 'md' | 'svg' | 'png', bytes: Uint8Array): Promise<boolean> {
    const uri = await vscode.window.showSaveDialog({ title: extension === 'md' ? 'Export Launch Review report' : 'Export Launch Review share card',
      defaultUri: vscode.Uri.file(join(homedir(), `shipstats-launch-review-${new Date().toISOString().slice(0, 10)}.${extension}`)),
      filters: { [extension === 'md' ? 'Markdown report' : 'Share card']: [extension] } });
    if (!uri) return false;
    await vscode.workspace.fs.writeFile(uri, bytes); return true;
  }
  private async exportLaunch(message: Record<string,unknown>): Promise<void> {
    const format=message.format;
    if (format !== 'md' && format !== 'svg') throw new Error('Choose Markdown or SVG export.');
    if(format==='md' && !this.launchReport)throw new Error('Generate a launch report first.');
    const text = format === 'md' ? launchMarkdown(this.launchReport!) : this.cardSvg(message);
    if (await this.writeLaunchFile(format, Buffer.from(text, 'utf8'))) this.notice = format === 'md' ? 'Launch report exported.' : 'SVG share card exported.';
  }
  async add(source?: Source): Promise<void> {
    this.open();
    const options: { label: string; description: string; source: Source }[] = [
      { label: 'npm package', description: '7 / 30 / 90-day download trends', source: 'npm' },
      { label: 'VS Code Marketplace', description: 'Public cumulative install count', source: 'marketplace' },
      { label: 'Open VSX', description: 'Public cumulative download count', source: 'openvsx' },
      { label: 'Reddit post', description: 'Optional · requires approved OAuth API access', source: 'reddit' }
    ];
    const choice = source ? options.find(option => option.source === source) : await vscode.window.showQuickPick(options, { title: 'Add a product to ShipStats' });
    if (!choice) return;
    const value = await vscode.window.showInputBox({
      title: `Track ${choice.label}`,
      prompt: choice.source === 'npm' ? 'Package name, e.g. @scope/package' : choice.source === 'reddit' ? 'Full Reddit post URL or post ID. Only comment counts are read.' : 'Extension identifier, e.g. redhat.vscode-yaml',
      ignoreFocusOut: true,
      validateInput: input => { try { product(choice.source, input); return undefined; } catch (e) { return errorMessage(e); } }
    });
    if (value === undefined) return;
    await this.save([...this.products, product(choice.source, value)]); await this.refresh();
    void this.panel?.webview.postMessage({ type: 'navigate', page: 'overview' });
  }
  async refresh(): Promise<void> {
    this.collection.lastAttemptAt=new Date().toISOString();this.collection.error=undefined;
    try {
      await this.collectRefresh();
      const successes=this.readings.filter(r=>!r.error && r.metric && r.fetchedAt);
      this.collection.successfulProducts=successes.length;
      const latest=successes.map(r=>r.fetchedAt!).sort().at(-1);if(latest)this.collection.lastSuccessAt=latest;
      const failed=this.readings.filter(r=>r.error).length;if(failed)this.collection.error=`${failed} source(s) failed. Review source health.`;
    } catch(error) {this.collection.error=errorMessage(error);throw error;}
    finally {await this.context.globalState.update(COLLECTION,this.collection);}
  }
  private async collectRefresh(): Promise<void> {
    this.comparison = undefined;
    this.launchReport = undefined; this.launchReviewError = undefined; this.pendingShare = undefined;
    const hasReddit = this.products.some(p => p.source === 'reddit');
    const token = hasReddit ? await this.context.secrets.get(TOKEN) : undefined;
    const ua = this.config().get<string>('redditUserAgent', '');
    this.readings = await parallelMap(this.products, p => this.analytics.read(p, token, ua));
    // Evaluate before persistence, retaining pending events if either history or monitoring storage fails.
    this.pendingMonitoring = evaluateRules(this.pendingMonitoring ?? this.monitoring, this.products, this.readings);
    const history = new History([...this.history.entries(), ...this.pendingHistory], this.products);
    history.record(this.readings);
    if (JSON.stringify(history.entries()) !== JSON.stringify(this.history.entries())) {
      // Do not advertise a successful save if local persistence failed.
      // Retain compact observations in memory so a cached retry can still save them.
      this.pendingHistory = history.entries();
      await this.context.globalState.update(HISTORY, history.entries());
    }
    this.pendingHistory = [];
    this.history = history;
    const monitoring = this.pendingMonitoring;
    if (JSON.stringify(monitoring) !== JSON.stringify(this.monitoring)) await this.context.globalState.update(MONITOR, monitoring);
    this.monitoring = monitoring; this.pendingMonitoring = undefined;
    this.send();
  }
  async exportCsv(): Promise<void> {
    this.open();
    const history = new History(this.history.entries(), this.products);
    if (!history.entries().length) { this.notice = 'No saved observations to export. Refresh a tracked product first.'; return; }
    const uri = await vscode.window.showSaveDialog({
      title: 'Export ShipStats saved observations',
      defaultUri: vscode.Uri.file(join(homedir(), `shipstats-history-${new Date().toISOString().slice(0, 10)}.csv`)),
      filters: { 'CSV files': ['csv'] }
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(historyCsv(history.entries()), 'utf8'));
    this.notice = `Exported ${history.entries().length} saved observations from all tracked products. npm observations include one row per window.`;
  }
  async setToken(): Promise<void> {
    const token = await vscode.window.showInputBox({ title: 'Reddit OAuth access token', password: true, ignoreFocusOut: true, prompt: 'Requires approved Reddit Data API access. Stored in VS Code SecretStorage. Short-lived tokens must be replaced manually.' });
    if (token === undefined) return;
    if (!token.trim() || /\s/.test(token.trim())) throw new Error('Enter the access token only, without “Bearer” or whitespace.');
    await this.context.secrets.store(TOKEN, token.trim()); this.analytics.clearReddit(); await this.refresh();
    this.notice = 'Reddit token saved securely. Access still depends on approval, token validity, and User-Agent configuration.';
  }
  async clearToken(): Promise<void> {
    await this.context.secrets.delete(TOKEN); this.analytics.clearReddit();
    this.readings = this.readings.filter(r => r.product.source !== 'reddit');
    this.history.clearSource('reddit');
    this.pendingHistory = this.pendingHistory.filter(s => s.product.source !== 'reddit');
    this.monitoring = restoreMonitor(this.monitoring, this.products.filter(p => p.source !== 'reddit'));
    if (this.pendingMonitoring) this.pendingMonitoring = restoreMonitor(this.pendingMonitoring, this.products.filter(p => p.source !== 'reddit'));
    await this.context.globalState.update(HISTORY, this.history.entries());
    await this.context.globalState.update(MONITOR, this.monitoring);
    await this.refresh();
    this.notice = 'Reddit access token cleared.';
  }
  private schedule(): void {
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    if (this.backgroundTimer) clearInterval(this.backgroundTimer);this.backgroundTimer=undefined;
    const minutes = this.config().get<number>('refreshMinutes', 0);
    if (this.panel && Number.isFinite(minutes) && minutes > 0) this.timer = setInterval(() => {
      if (this.panel?.visible && !this.busy) void this.run(() => this.refresh());
    }, Math.max(5, Math.min(1440, minutes)) * 60000);
    const collectionMinutes=this.config().get<number>('collectionMinutes',1440);
    if(!this.config().get<boolean>('backgroundCollection',false))void this.collectorLease.release();
    if(this.config().get<boolean>('backgroundCollection',false) && Number.isFinite(collectionMinutes))this.backgroundTimer=setInterval(()=>{
      if(!this.disposed && !this.busy && this.products.length)void this.run(()=>this.collectInBackground(),true);
    },Math.max(10,Math.min(1440,collectionMinutes))*60000);
  }
  private send(): void {
    if (!this.panel || this.disposed) return;
    const scope = this.config().get<string>('npmScope', '');
    const identity = this.discoveryKey?.slice(this.discoveryKey.indexOf(':') + 1);
    void this.panel.webview.postMessage({ type: 'state', products: this.products,
      readings: this.readings.map(reading => ({ ...reading, health: readingHealth(reading) })),
      history: this.history.entries(),
      insights: this.insights, comparison: this.comparison,
      launchReport: this.launchReport, launchReviewError: this.launchReviewError, monitoring: this.monitoring,
      storage:storageHealth(this.products,this.history.entries(),this.insights,this.monitoring),
      progress:progressSummary(this.products,this.readings,this.history.entries(),this.monitoring),
      collection:{...this.collection,enabled:this.config().get<boolean>('backgroundCollection',false),minutes:this.config().get<number>('collectionMinutes',1440)},
      releaseSuggestions:this.releaseSuggestions,
      backupReview:this.pendingBackup ? {id:this.pendingBackup.id,createdAt:this.pendingBackup.data.createdAt,products:this.pendingBackup.data.products.length,snapshots:this.pendingBackup.data.history.length,groups:this.pendingBackup.data.insights.groups.length,markers:this.pendingBackup.data.insights.markers.length,rules:this.pendingBackup.data.monitoring.rules.length} : undefined,
      dateLimits: { start: dateAt(new Date(), -180), end: dateAt(new Date(), -1), today: dateAt(new Date(), 0) },
      discovery: this.discovery, busy: this.busy, notice: this.notice,
      discoveryKey: this.discoveryKey,
      identity: identity ?? (scope || this.config().get<string>('npmUsername', '')),
      scope: this.discoveryKey ? this.discoveryKey.startsWith('scope:') : !!scope });
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64');
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name)).toString();
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
      <link rel="stylesheet" href="${asset('dashboard.css')}"><title>ShipStats</title></head><body>
      <main id="app" data-logo="${asset('shipstats-icon.png')}"></main><script nonce="${nonce}" src="${asset('dashboard.js')}"></script></body></html>`;
  }
  dispose(): void { this.disposed = true; if (this.timer) clearInterval(this.timer); if(this.backgroundTimer)clearInterval(this.backgroundTimer);void this.collectorLease.release();this.panel?.dispose(); this.disposables.forEach(d => d.dispose()); }
}
