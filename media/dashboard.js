/* Remote content is always inserted as text. No provider HTML is rendered. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const saved = vscode.getState() || {};
  let period = [7, 30, 90].includes(saved.period) ? saved.period : 30;
  let page = ['overview', 'packages', 'integrations'].includes(saved.page) ? saved.page : 'packages';
  let state = { products: [], readings: [], busy: true, notice: '' };
  let selection = new Set(), signature = '', query = '', identityDirty = false, discoveryKey;
  let productQuery = '', sourceFilter = 'all', initialized = false, pendingSelection = false;
  const sources = { npm: 'npm', marketplace: 'Marketplace', openvsx: 'Open VSX', reddit: 'Reddit' };
  const fmt = value => value == null ? 'Unavailable' : new Intl.NumberFormat().format(value);
  const send = (type, data = {}) => vscode.postMessage({ type, ...data });
  const persist = () => vscode.setState({ period, page });
  const keyOf = p => `${p.source}:${p.id}`;
  const defaultCaveat = 'Public search can miss packages and does not verify ownership. Private packages are excluded. You can add a known package by name.';
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function button(text, action, className = '') {
    const b = node('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b;
  }
  function logo(className) {
    if (!app.dataset.logo) return node('span', '◈', className);
    const img = node('img'); img.src = app.dataset.logo; img.alt = ''; img.className = className; return img;
  }
  function pageHeading(title, copy, eyebrow) {
    const block = node('div', undefined, 'page-heading');
    block.append(node('div', eyebrow, 'eyebrow'), node('h1', title), node('p', copy, 'muted')); return block;
  }
  function setPage(next) {
    const changed = page !== next;
    page = next; persist();
    for (const [name, view] of Object.entries(views)) view.hidden = name !== page;
    for (const [name, b] of Object.entries(navButtons)) {
      b.classList.toggle('active', name === page);
      if (name === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    breadcrumb.textContent = page[0].toUpperCase() + page.slice(1);
    if (changed) { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }
  }

  // Persistent navigation keeps discovery separate from day-to-day monitoring.
  const sidebar = node('aside', undefined, 'sidebar');
  const brand = node('div', undefined, 'brand-lockup');
  const brandCopy = node('div'); brandCopy.append(node('strong', 'ShipStats', 'wordmark'), node('span', 'Developer analytics', 'brand-caption'));
  brand.append(logo('brand-icon'), brandCopy); sidebar.append(brand);
  sidebar.append(node('div', 'YOUR DASHBOARD', 'nav-label'));
  const nav = node('nav'); nav.setAttribute('aria-label', 'Dashboard navigation');
  const navButtons = {};
  for (const [name, title, glyph] of [['overview', 'Overview', '▦'], ['packages', 'Packages', '◇'], ['integrations', 'Integrations', '⌘']]) {
    const b = button('', () => setPage(name), 'nav-button');
    const icon = node('span', glyph, 'nav-icon'); icon.setAttribute('aria-hidden', 'true');
    b.append(icon, node('span', title)); b.setAttribute('aria-controls', `view-${name}`); navButtons[name] = b; nav.append(b);
  }
  sidebar.append(nav);
  const sourceList = node('div', undefined, 'sidebar-sources'); sourceList.append(node('div', 'TRACKED SOURCES', 'nav-label'));
  const sourceCounts = {};
  for (const [source, label] of Object.entries(sources)) {
    const row = node('div', undefined, 'source-row'); const name = node('span'); name.append(node('i', undefined, `source-dot ${source}`), node('span', label));
    const count = node('span', '0', 'source-count'); sourceCounts[source] = count; row.append(name, count); sourceList.append(row);
  }
  sidebar.append(sourceList);
  const sideNote = node('div', undefined, 'sidebar-note'); sideNote.append(node('span', 'A home for what you ship.', 'side-note-title'), node('p', 'Your products. Your signals. Stored locally in VS Code.', 'fine'));
  sidebar.append(sideNote); app.append(sidebar);

  const workspace = node('div', undefined, 'workspace');
  const topbar = node('header', undefined, 'topbar');
  const trail = node('div', undefined, 'breadcrumb'); trail.append(node('span', 'Dashboard'), node('span', '/', 'separator'));
  const breadcrumb = node('strong', 'Packages'); trail.append(breadcrumb);
  const actions = node('div', undefined, 'actions');
  const settings = button('Settings', () => send('settings'), 'ghost');
  const refresh = button('↻  Refresh', () => send('refresh'), 'ghost');
  const add = button('+ Add product', () => send('add'), 'primary'); actions.append(settings, refresh, add); topbar.append(trail, actions); workspace.append(topbar);
  const statusLine = node('div', undefined, 'status-line');
  const account = button('No npm account selected', () => setPage('packages'), 'account-chip');
  const status = node('span', 'Loading', 'status-chip');
  const notice = node('span', '', 'notice'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  statusLine.append(account, status, notice); workspace.append(statusLine);
  const content = node('div', undefined, 'content');
  const views = {};
  for (const name of ['overview', 'packages', 'integrations']) { const view = node('section', undefined, `view view-${name}`); view.id = `view-${name}`; view.setAttribute('aria-label', `${name} view`); views[name] = view; content.append(view); }
  workspace.append(content); app.append(workspace);

  // Overview: trustworthy totals, daily activity, then searchable product cards.
  const overviewHeading = node('div', undefined, 'overview-heading');
  overviewHeading.append(pageHeading('A little signal. A bigger picture.', 'See how your developer products are doing, all in one place.', 'PRODUCT OVERVIEW'));
  const periods = node('div', undefined, 'periods'); periods.setAttribute('role', 'group'); periods.setAttribute('aria-label', 'npm analytics period');
  for (const days of [7, 30, 90]) { const b = button(`${days} days`, () => { period = days; persist(); renderAnalytics(); }); b.dataset.days = String(days); periods.append(b); }
  overviewHeading.append(periods); views.overview.append(overviewHeading);
  const summary = node('div', undefined, 'summary'); views.overview.append(summary);
  const activity = node('section', undefined, 'activity panel'); views.overview.append(activity);
  const productHeading = node('div', undefined, 'section-heading');
  const productTitle = node('div'); productTitle.append(node('h2', 'Your products'), node('p', 'The metrics behind the things you make.', 'muted'));
  const shownCount = node('span', '', 'count-badge'); productHeading.append(productTitle, shownCount); views.overview.append(productHeading);
  const productToolbar = node('div', undefined, 'product-toolbar');
  const sourceFilters = node('div', undefined, 'source-filters'); sourceFilters.setAttribute('role', 'group'); sourceFilters.setAttribute('aria-label', 'Filter tracked products by source');
  for (const [value, label] of [['all', 'All products'], ...Object.entries(sources)]) {
    const b = button(label, () => { sourceFilter = value; renderAnalytics(); }, 'filter-chip'); b.dataset.source = value; sourceFilters.append(b);
  }
  const productSearch = node('input'); productSearch.type = 'search'; productSearch.placeholder = 'Search products…'; productSearch.setAttribute('aria-label', 'Search tracked products');
  productSearch.addEventListener('input', () => { productQuery = productSearch.value; renderAnalytics(); }); productToolbar.append(sourceFilters, productSearch); views.overview.append(productToolbar);
  const cards = node('div', undefined, 'cards'); views.overview.append(cards);
  const dataNote = node('div', undefined, 'data-note'); dataNote.append(node('span', 'ⓘ', 'info-symbol'), node('p', 'npm uses complete UTC days ending yesterday. Growth compares the previous equal-length period. Missing values stay unavailable; counts are not unique people.', 'fine')); views.overview.append(dataNote);

  // Packages: one clear path from identity to an explicit saved selection.
  views.packages.append(pageHeading('Find your packages. Follow their growth.', 'Start with your npm username or scope, then choose what you want to track.', 'PACKAGE DISCOVERY'));
  const steps = node('ol', undefined, 'steps');
  for (const [number, title, copy] of [['1', 'Find packages', 'Search a public npm identity'], ['2', 'Choose what matters', 'Select packages to monitor'], ['3', 'Follow the signal', 'Explore download trends']]) {
    const step = node('li'); const text = node('div'); text.append(node('strong', title), node('span', copy)); step.append(node('span', number, 'step-number'), text); steps.append(step);
  }
  views.packages.append(steps);
  const discover = node('section', undefined, 'discover panel');
  const discoverTop = node('div', undefined, 'discover-top'); const intro = node('div'); intro.append(node('h2', 'Connect your npm identity'), node('p', 'No login or API key needed for public package analytics.', 'muted'));
  discoverTop.append(intro, node('span', 'PUBLIC REGISTRY', 'subtle-badge')); discover.append(discoverTop);
  const form = node('form', undefined, 'discovery-form');
  const modeLabel = node('label', 'Discover by'); const mode = node('select'); mode.id = 'mode'; mode.setAttribute('aria-label', 'Discover by');
  for (const [value, text] of [['username', 'npm username'], ['scope', 'npm scope']]) { const opt = node('option', text); opt.value = value; mode.append(opt); } modeLabel.append(mode);
  const idLabel = node('label', 'Username or scope'); const identity = node('input'); identity.id = 'identity'; identity.placeholder = 'e.g. your-npm-username'; identity.required = true; identity.maxLength = 214; identity.autocomplete = 'off'; idLabel.append(identity);
  identity.addEventListener('input', () => { identityDirty = true; }); mode.addEventListener('change', () => { identityDirty = true; identity.placeholder = mode.value === 'scope' ? 'e.g. @your-scope' : 'e.g. your-npm-username'; });
  const search = node('button', 'Find packages', 'primary'); search.type = 'submit';
  form.addEventListener('submit', e => { e.preventDefault(); if (!state.busy) send('discover', { identity: identity.value, scope: mode.value === 'scope' }); });
  form.append(modeLabel, idLabel, search); discover.append(form);
  const resetNote = node('div', undefined, 'reset-note'); resetNote.append(node('span', '↔', 'info-symbol'), node('p', 'Switching username or scope starts a fresh npm dashboard and clears previous npm tracking.', 'fine')); discover.append(resetNote);
  const picker = node('div', undefined, 'picker'); picker.hidden = true;
  const resultsHeading = node('div', undefined, 'results-heading'); const resultsTitle = node('h3', 'Published packages'); const resultCount = node('span', '', 'count-badge'); resultsHeading.append(resultsTitle, resultCount); picker.append(resultsHeading);
  const pickTop = node('div', undefined, 'picker-top');
  const filter = node('input'); filter.type = 'search'; filter.placeholder = 'Filter discovered packages…'; filter.setAttribute('aria-label', 'Filter discovered packages');
  filter.addEventListener('input', () => { query = filter.value; renderCandidates(); });
  const selectAll = button('Select visible', () => { filtered().forEach(p => selection.add(p.name)); renderCandidates(); }, 'ghost');
  const clear = button('Clear visible', () => { filtered().forEach(p => selection.delete(p.name)); renderCandidates(); }, 'ghost'); pickTop.append(filter, selectAll, clear);
  const list = node('div', undefined, 'package-list'); const pickFooter = node('div', undefined, 'picker-footer');
  const selectionLabel = node('span', '', 'selection-label');
  const track = button('Track selected packages', () => { pendingSelection = true; send('select', { names: [...selection] }); }, 'primary');
  pickFooter.append(selectionLabel, track); picker.append(pickTop, list, pickFooter); discover.append(picker);
  const discoveryInfo = node('details', undefined, 'discovery-info'); discoveryInfo.append(node('summary', 'About package discovery'));
  const caveat = node('p', defaultCaveat, 'fine'); discoveryInfo.append(caveat); discover.append(discoveryInfo); views.packages.append(discover);
  const manual = node('div', undefined, 'manual-callout'); const manualCopy = node('div'); manualCopy.append(node('strong', 'Already know the package name?'), node('p', 'Track any public package directly, including scoped packages.', 'muted'));
  manual.append(node('span', '◇', 'manual-icon'), manualCopy, button('Add a package manually', () => send('add', { source: 'npm' }), 'ghost')); views.packages.append(manual);

  // Integrations: explain each metric before asking users to connect a source.
  views.integrations.append(pageHeading('More of your world, together.', 'Bring extension metrics and community activity alongside your npm packages.', 'YOUR INTEGRATIONS'));
  const integrationGrid = node('div', undefined, 'integration-grid');
  const integrationCounts = {};
  for (const [source, title, glyph, description, metric] of [
    ['marketplace', 'VS Code Marketplace', '⌘', 'Keep an eye on the extensions you publish for VS Code.', 'Cumulative public installs'],
    ['openvsx', 'Open VSX', '◇', 'See download counts from the open extension registry.', 'Cumulative public downloads'],
    ['reddit', 'Reddit', '◌', 'Monitor the comment count on posts about your products.', 'Current comments · approved API access required']
  ]) {
    const card = node('article', undefined, `integration-card panel ${source}`); const icon = node('span', glyph, `integration-icon ${source}`);
    const count = node('span', '0 tracked', 'count-badge'); integrationCounts[source] = count;
    const top = node('div', undefined, 'integration-top'); top.append(icon, count); card.append(top, node('h2', title), node('p', description, 'muted'), node('div', metric, 'integration-metric'));
    card.append(button('Add product', () => send('add', { source }), 'ghost')); integrationGrid.append(card);
  }
  views.integrations.append(integrationGrid);
  const reddit = node('section', undefined, 'reddit-access panel'); reddit.append(node('h2', 'Set up Reddit access'), node('p', 'Optional. Use it only if you already have approved Reddit Data API access.', 'muted'));
  const redditSteps = node('ol', undefined, 'access-steps');
  for (const text of ['Set a descriptive app/version and Reddit username in shipstats.redditUserAgent.', 'Save a valid OAuth access token using the secure token command below.', 'Add a post URL to track its current comment count. Replace the token when it expires.']) redditSteps.append(node('li', text));
  reddit.append(redditSteps, button('Set access token', () => send('token'), 'primary'), button('Clear access token', () => send('clearToken'), 'ghost'));
  reddit.append(node('p', 'The token stays in VS Code SecretStorage. ShipStats reads comment counts only, with no scraping fallback, automatic login, or new-comment notifications.', 'fine')); views.integrations.append(reddit);
  const limitations = node('div', undefined, 'data-note'); limitations.append(node('span', 'ⓘ', 'info-symbol'), node('p', 'Each source keeps its own meaning. Marketplace installs, Open VSX downloads and Reddit comments are separate from npm downloads; historical trends are available only for npm.', 'fine')); views.integrations.append(limitations);
  const footer = node('footer'); footer.append(node('span', 'ShipStats', 'footer-brand'), node('span', 'Local storage · No ShipStats telemetry · 10-minute source cache', 'fine')); workspace.append(footer);

  function filtered() { return (state.discovery?.packages || []).filter(p => p.name.toLowerCase().includes(query.toLowerCase())); }
  function renderCandidates() {
    if (!state.discovery) { picker.hidden = true; list.replaceChildren(); selectionLabel.textContent = ''; caveat.textContent = defaultCaveat; return; }
    picker.hidden = false; const scroll = list.scrollTop; list.replaceChildren();
    const candidates = filtered(); resultCount.textContent = `${candidates.length} of ${state.discovery.packages.length}`;
    if (!candidates.length) list.append(node('p', state.discovery.packages.length ? 'No matches for this filter.' : 'No public packages found. Try another identity or add a package manually.', 'list-empty muted'));
    for (const p of candidates) {
      const row = node('label', undefined, 'package-option'); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selection.has(p.name); checkbox.disabled = state.busy;
      checkbox.addEventListener('change', () => { if (checkbox.checked) selection.add(p.name); else selection.delete(p.name); updateSelectionLabel(); });
      const copy = node('span', undefined, 'package-copy'); copy.append(node('strong', p.name), node('small', p.description || 'No description provided', 'muted'));
      row.append(checkbox, node('span', '◇', 'package-glyph'), copy); list.append(row);
    }
    list.scrollTop = scroll; updateSelectionLabel();
    track.disabled = selectAll.disabled = clear.disabled = state.busy; caveat.textContent = state.discovery.note;
  }
  function updateSelectionLabel() { selectionLabel.textContent = `${selection.size} selected · up to 50 tracked products`; }
  function svgNode(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); return el;
  }
  function sparkline(daily, days, end, large = false) {
    const chart = node('div', undefined, large ? 'chart chart-large' : 'chart');
    const height = large ? 164 : 86, top = 10, bottom = height - 10;
    const svg = svgNode('svg', { viewBox: `0 0 480 ${height}`, preserveAspectRatio: 'none', role: 'img' });
    const endDate = new Date(`${end}T00:00:00Z`), byDate = new Map(daily.map(d => [d.day, d.downloads])), values = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(endDate); d.setUTCDate(d.getUTCDate() - i); values.push(byDate.get(d.toISOString().slice(0, 10))); }
    const max = Math.max(1, ...values.filter(n => n !== undefined));
    for (const y of [top, (top + bottom) / 2, bottom]) svg.append(svgNode('line', { x1: 0, y1: y, x2: 480, y2: y, class: 'chart-grid' }));
    let segment = [];
    const addSegment = () => {
      if (!segment.length) return;
      if (segment.length > 1) svg.append(svgNode('polygon', { points: `${segment[0].split(',')[0]},${bottom} ${segment.join(' ')} ${segment.at(-1).split(',')[0]},${bottom}`, class: 'chart-area' }));
      svg.append(svgNode('polyline', { points: segment.join(' ') })); segment = [];
    };
    values.forEach((value, i) => {
      if (value === undefined) { addSegment(); return; }
      const x = i / (days - 1) * 480, y = bottom - value / max * (bottom - top); segment.push(`${x},${y}`);
      const dot = svgNode('circle', { cx: x, cy: y, r: 2.5, class: 'chart-point' }); const title = svgNode('title'); title.textContent = `${days - i - 1} day(s) before ${end}: ${fmt(value)} downloads`; dot.append(title); svg.append(dot);
    }); addSegment();
    svg.setAttribute('aria-label', `${days}-day daily downloads, up to ${fmt(max)} per day. Missing days appear as gaps. Use daily values for exact counts.`);
    chart.append(svg); return chart;
  }
  function dateBounds(end, days) {
    const first = new Date(`${end}T00:00:00Z`); first.setUTCDate(first.getUTCDate() - days + 1);
    const bounds = node('div', undefined, 'chart-bounds'); bounds.append(node('span', first.toISOString().slice(0, 10)), node('span', 'UTC', 'chart-unit'), node('span', end)); return { bounds, start: first.toISOString().slice(0, 10) };
  }
  function renderAnalytics() {
    for (const b of periods.children) { const active = Number(b.dataset.days) === period; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }
    for (const b of sourceFilters.children) { const active = b.dataset.source === sourceFilter; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }
    for (const source of Object.keys(sources)) {
      const count = state.products.filter(p => p.source === source).length; sourceCounts[source].textContent = String(count);
      if (integrationCounts[source]) integrationCounts[source].textContent = `${count} tracked`;
    }
    cards.replaceChildren(); summary.replaceChildren(); activity.replaceChildren();
    const npmProducts = state.products.filter(p => p.source === 'npm'), trackedKeys = new Set(state.products.map(keyOf));
    const valid = state.readings.filter(r => trackedKeys.has(keyOf(r.product)) && r.metric?.kind === 'npm' && !r.error && r.metric.windows.find(w => w.days === period)?.total != null);
    const total = valid.reduce((n, r) => n + r.metric.windows.find(w => w.days === period).total, 0);
    const heroStat = node('div', undefined, 'hero-stat panel'); heroStat.append(node('div', `NPM DOWNLOADS · LAST ${period} DAYS`, 'eyebrow'), node('strong', valid.length ? fmt(total) : '—', 'summary-total'));
    heroStat.append(node('p', npmProducts.length ? `${valid.length} of ${npmProducts.length} npm packages with complete, current data. ${valid.length !== npmProducts.length ? 'Total is partial.' : ''}` : 'Choose npm packages to start seeing download trends.', 'fine'));
    summary.append(heroStat);
    const errors = state.readings.filter(r => trackedKeys.has(keyOf(r.product)) && r.error).length;
    for (const [label, value, caption, glyph] of [
      ['Tracked products', state.products.length, 'Across your connected sources', '◇'],
      ['Reporting packages', `${valid.length}/${npmProducts.length}`, 'Complete npm data this period', '↗'],
      ['Need attention', errors, errors ? 'Check the source message on each card' : 'No source errors reported', '◌']
    ]) { const stat = node('div', undefined, 'stat-card panel'); stat.append(node('span', glyph, 'stat-icon'), node('span', label, 'muted'), node('strong', String(value), 'stat-value'), node('small', caption, 'fine')); summary.append(stat); }
    const activityTop = node('div', undefined, 'activity-top'); const activityCopy = node('div'); activityCopy.append(node('h2', 'Download activity'), node('p', 'Daily npm downloads from packages with complete data.', 'muted')); activityTop.append(activityCopy, node('span', `${period} DAYS · UTC`, 'subtle-badge')); activity.append(activityTop);
    // Keep a common date range when a fetch straddles UTC midnight.
    const end = valid.map(r => r.metric.end).sort().at(-1);
    const aligned = valid.filter(r => r.metric.end === end);
    if (aligned.length) {
      const sums = new Map(); for (const r of aligned) for (const d of r.metric.daily) sums.set(d.day, (sums.get(d.day) || 0) + d.downloads);
      activity.append(sparkline([...sums].map(([day, downloads]) => ({ day, downloads })), period, end, true), dateBounds(end, period).bounds);
      activity.append(node('p', `${aligned.length} reporting npm package${aligned.length === 1 ? '' : 's'} · Other source metrics are shown separately below.`, 'fine activity-note'));
    } else { const empty = node('div', undefined, 'chart-empty'); empty.append(node('span', '↗', 'empty-symbol'), node('strong', 'Your next chapter starts with a package.'), node('p', 'Select npm packages to bring this chart to life.', 'muted'), button('Find npm packages', () => setPage('packages'), 'ghost')); activity.append(empty); }
    const visible = state.products.filter(p => (sourceFilter === 'all' || p.source === sourceFilter) && p.id.toLowerCase().includes(productQuery.toLowerCase()));
    shownCount.textContent = `${visible.length} of ${state.products.length}`;
    if (!visible.length) {
      const empty = node('div', undefined, 'empty panel');
      if (state.products.length) empty.append(node('h3', 'No matching products'), node('p', 'Try another name or choose a different source.', 'muted'), button('Clear filters', () => { productQuery = ''; productSearch.value = ''; sourceFilter = 'all'; renderAnalytics(); }, 'ghost'));
      else empty.append(node('span', '◇', 'empty-symbol'), node('h3', 'Make room for your next big thing.'), node('p', 'Discover your npm packages, or add a product by name.', 'muted'), button('Find npm packages', () => setPage('packages'), 'primary'), button('Add a package manually', () => send('add', { source: 'npm' }), 'ghost'));
      cards.append(empty); return;
    }
    for (const p of visible) {
      const key = keyOf(p), reading = state.readings.find(r => keyOf(r.product) === key);
      const card = node('article', undefined, `product panel source-${p.source}`);
      const top = node('div', undefined, 'card-top'); const source = node('span', undefined, 'product-source'); source.append(node('i', undefined, `source-dot ${p.source}`), node('span', sources[p.source]));
      const remove = button('×', () => send('remove', { key }), 'remove'); remove.setAttribute('aria-label', `Stop tracking ${p.id}`); remove.disabled = state.busy; top.append(source, remove); card.append(top, node('h3', p.id));
      if (reading?.error) { const error = node('p', reading.stale ? `Previous reading · ${reading.error}` : reading.error, 'error'); error.setAttribute('role', 'status'); card.append(error); }
      const metric = reading?.metric;
      if (metric?.kind === 'npm') {
        const windowMetric = metric.windows.find(w => w.days === period); const change = windowMetric?.change;
        card.append(node('div', fmt(windowMetric?.total), 'metric'), node('span', `downloads · ${period} complete UTC days`, 'muted metric-label'));
        card.append(node('p', change == null ? windowMetric?.previous === 0 ? 'No growth rate: preceding period was zero.' : 'Growth unavailable: incomplete comparison data.' : `${change >= 0 ? '↗ +' : '↘ '}${change.toFixed(1)}% vs preceding ${period} days`, change == null ? 'trend muted' : change >= 0 ? 'trend positive' : 'trend negative'));
        card.append(sparkline(metric.daily, period, metric.end)); const bounds = dateBounds(metric.end, period); card.append(bounds.bounds);
        const detail = node('details', undefined, 'daily-details'); detail.append(node('summary', 'Daily values'));
        const tableWrap = node('div', undefined, 'table-wrap'), table = node('table'); table.append(node('caption', 'Source-reported daily npm downloads'));
        const head = node('thead'), headerRow = node('tr'); for (const label of ['UTC date', 'Downloads']) { const th = node('th', label); th.scope = 'col'; headerRow.append(th); } head.append(headerRow); table.append(head);
        const body = node('tbody'); for (const d of metric.daily.filter(d => d.day >= bounds.start)) { const row = node('tr'); row.append(node('td', d.day), node('td', fmt(d.downloads))); body.append(row); } table.append(body); tableWrap.append(table); detail.append(tableWrap); card.append(detail);
      } else if (metric?.kind === 'count') {
        if (metric.title) card.append(node('p', metric.title, 'muted'));
        card.append(node('div', fmt(metric.value), 'metric'), node('p', metric.label, 'muted metric-label'));
        const countNote = node('div', undefined, 'count-note'); countNote.append(node('span', p.source === 'reddit' ? '◌' : '◇', 'count-note-icon'), node('span', 'No historical trend is provided for this source.', 'fine')); card.append(countNote);
      } else if (!reading?.error) card.append(node('p', state.busy ? 'Loading source data…' : 'No reading yet. Refresh to load.', 'muted loading-reading'));
      const bottom = node('div', undefined, 'card-bottom');
      const freshness = node('small', reading?.fetchedAt ? `${reading.stale ? 'Last success' : 'Fetched'} ${new Date(reading.fetchedAt).toLocaleString()}` : 'No successful reading', 'muted');
      bottom.append(freshness, button('View source ↗', () => send('source', { key }), 'source-link')); card.append(bottom); cards.append(card);
    }
  }
  window.addEventListener('message', event => {
    if (event.data?.type === 'navigate') {
      if (Object.hasOwn(views, event.data.page)) {
        if (event.data.page === 'overview') { sourceFilter = 'all'; productQuery = ''; productSearch.value = ''; renderAnalytics(); }
        setPage(event.data.page);
      }
      return;
    }
    if (event.data?.type !== 'state') return;
    state = event.data;
    if (!initialized) { initialized = true; if (!saved.page) page = state.products.length ? 'overview' : 'packages'; }
    if (discoveryKey !== state.discoveryKey) {
      discoveryKey = state.discoveryKey; query = ''; filter.value = ''; selection = new Set(); signature = '';
      identityDirty = false; productQuery = ''; productSearch.value = ''; sourceFilter = 'all';
    }
    if (!identityDirty) { identity.value = state.identity || ''; mode.value = state.scope ? 'scope' : 'username'; }
    const newSignature = JSON.stringify([state.discovery?.packages.map(p => p.name), state.products.filter(p => p.source === 'npm').map(p => p.id)]);
    if (signature !== newSignature) { signature = newSignature; selection = new Set(state.products.filter(p => p.source === 'npm').map(p => p.id).filter(id => state.discovery?.packages.some(p => p.name === id))); }
    account.textContent = state.identity ? `${state.scope ? '@' : ''}${state.identity}  ↗` : 'Connect your npm identity ↗';
    status.textContent = state.busy ? 'Syncing' : 'Ready'; status.classList.toggle('syncing', state.busy);
    notice.textContent = state.notice || (state.busy ? 'Fetching the latest signals…' : 'Readings are cached for 10 minutes.');
    app.setAttribute('aria-busy', String(state.busy)); refresh.disabled = add.disabled = search.disabled = state.busy;
    refresh.textContent = state.busy ? '↻  Syncing…' : '↻  Refresh';
    if (pendingSelection && !state.busy) { pendingSelection = false; if (!state.notice && state.products.some(p => p.source === 'npm')) { sourceFilter = 'all'; productQuery = ''; productSearch.value = ''; setPage('overview'); } }
    renderCandidates(); renderAnalytics(); setPage(page);
  });
  renderAnalytics(); setPage(page); send('ready');
})();
