/* Remote content is always inserted as text. No provider HTML is rendered. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const saved = vscode.getState() || {};
  let period = [7, 30, 90].includes(saved.period) ? saved.period : 30;
  let page = ['overview', 'packages', 'integrations', 'insights', 'launch', 'health'].includes(saved.page) ? saved.page : 'packages';
  let state = { products: [], readings: [], busy: true, notice: '' };
  let selection = new Set(), signature = '', query = '', identityDirty = false, discoveryKey;
  let productQuery = '', sourceFilter = 'all', initialized = false, pendingSelection = false;
  let selectedGroupId = typeof saved.groupId === 'string' ? saved.groupId : '';
  let insightSignature = '', groupEditorId = '', markerEditorId = '', pendingGroupSave = false, pendingMarkerSave = false;
  const sources = { npm: 'npm', marketplace: 'Marketplace', openvsx: 'Open VSX', reddit: 'Reddit' };
  const fmt = value => value == null ? 'Unavailable' : new Intl.NumberFormat().format(value);
  const send = (type, data = {}) => vscode.postMessage({ type, ...data });
  const persist = () => vscode.setState({ period, page, groupId: selectedGroupId });
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
  for (const [name, title, glyph] of [['overview', 'Overview', '▦'], ['packages', 'Packages', '◇'], ['integrations', 'Integrations', '⌘'], ['insights', 'Insights', '+'], ['launch', 'Launch Review', '*'], ['health', 'Health & progress', '+']]) {
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
  const exportCsv = button('Export CSV', () => send('export'), 'ghost');
  exportCsv.title = 'Export saved observations for all tracked products';
  const add = button('+ Add product', () => send('add'), 'primary'); actions.append(settings, refresh, exportCsv, add); topbar.append(trail, actions); workspace.append(topbar);
  const statusLine = node('div', undefined, 'status-line');
  const account = button('No npm account selected', () => setPage('packages'), 'account-chip');
  const status = node('span', 'Loading', 'status-chip');
  const notice = node('span', '', 'notice'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  statusLine.append(account, status, notice); workspace.append(statusLine);
  const content = node('div', undefined, 'content');
  const views = {};
  for (const name of ['overview', 'packages', 'integrations', 'insights', 'launch', 'health']) { const view = node('section', undefined, `view view-${name}`); view.id = `view-${name}`; view.setAttribute('aria-label', `${name} view`); views[name] = view; content.append(view); }
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
  const groupFilterLabel = node('label', 'Product group', 'group-filter');
  const groupFilter = node('select'); groupFilter.setAttribute('aria-label', 'Product group filter');
  groupFilter.addEventListener('change', () => { selectedGroupId = groupFilter.value; persist(); renderAnalytics(); });
  groupFilterLabel.append(groupFilter); views.overview.append(groupFilterLabel);
  const groupScope = node('p', '', 'fine group-scope'); views.overview.append(groupScope);
  const sourceFilters = node('div', undefined, 'source-filters'); sourceFilters.setAttribute('role', 'group'); sourceFilters.setAttribute('aria-label', 'Filter tracked products by source');
  for (const [value, label] of [['all', 'All products'], ...Object.entries(sources)]) {
    const b = button(label, () => { sourceFilter = value; renderAnalytics(); }, 'filter-chip'); b.dataset.source = value; sourceFilters.append(b);
  }
  const productSearch = node('input'); productSearch.type = 'search'; productSearch.placeholder = 'Search products…'; productSearch.setAttribute('aria-label', 'Search tracked products');
  productSearch.addEventListener('input', () => { productQuery = productSearch.value; renderAnalytics(); }); productToolbar.append(sourceFilters, productSearch); views.overview.append(productToolbar);
  const cards = node('div', undefined, 'cards'); views.overview.append(cards);
  const historyNote = node('p', 'Saved observations are captured on successful refreshes while VS Code is running. Scheduled refreshes require an open, visible dashboard. Cache hits add no observations. Keep up to 100 per product for 90 days. Removing a product or switching npm identity clears the affected history. Export CSV includes all tracked products, regardless of filters.', 'history-note fine'); views.overview.append(historyNote);
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
  const limitations = node('div', undefined, 'data-note'); limitations.append(node('span', 'ⓘ', 'info-symbol'), node('p', 'Each source keeps its own meaning. npm supplies daily history. Marketplace installs, Open VSX downloads and Reddit comments have local observations from successful fetches only; gaps are not filled or backdated.', 'fine')); views.integrations.append(limitations);
  const footer = node('footer'); footer.append(node('span', 'ShipStats', 'footer-brand'), node('span', 'Local storage · No ShipStats telemetry · 10-minute source cache', 'fine')); workspace.append(footer);

  // Insights editors stay mounted so host messages do not erase a draft.
  views.insights.append(pageHeading('Understand what changed.', 'Group related products, mark releases and compare two date ranges.', 'PRODUCT INSIGHTS'));
  const insightGrid = node('div', undefined, 'insight-editors'); views.insights.append(insightGrid);
  const groupPanel = node('section', undefined, 'panel insight-editor'); groupPanel.append(node('h2', 'Product groups'), node('p', 'A product can belong to several groups. Group totals combine npm downloads only.', 'fine'));
  const markerPanel = node('section', undefined, 'panel insight-editor'); markerPanel.append(node('h2', 'Release markers'), node('p', 'Add a release date manually. Markers show timing, not proof of impact.', 'fine'));
  insightGrid.append(groupPanel, markerPanel);
  function field(parent, title, control) { const label = node('label', title); control.setAttribute('aria-label', title); label.append(control); parent.append(label); return control; }
  function options(select, items, selected) { select.replaceChildren(); for (const [value, title] of items) { const option = node('option', title); option.value = value; select.append(option); } select.value = items.some(([value]) => value === selected) ? selected : items[0]?.[0] || ''; }
  const groupForm = node('form', undefined, 'insight-form'); groupPanel.append(groupForm);
  const groupEditor = field(groupForm, 'Edit product group', node('select'));
  const groupName = field(groupForm, 'Group name', node('input')); groupName.required = true; groupName.maxLength = 60;
  const groupMembers = node('fieldset', undefined, 'group-members'); groupMembers.append(node('legend', 'Tracked products in this group')); groupForm.append(groupMembers);
  const groupActions = node('div', undefined, 'insight-actions');
  const groupSave = node('button', 'Save group', 'primary'); groupSave.type = 'submit';
  const groupDelete = button('Delete group', () => send('groupDelete', { id: groupEditorId }), 'ghost');
  groupActions.append(groupSave, groupDelete); groupForm.append(groupActions);
  let draftMembers = new Set();
  function renderMembers() {
    groupMembers.replaceChildren(node('legend', 'Tracked products in this group'));
    if (!state.products.length) groupMembers.append(node('p', 'Track a product first, or save an empty group for later.', 'fine'));
    for (const p of state.products) {
      const row = node('label'), input = node('input'); input.type = 'checkbox'; input.value = keyOf(p); input.checked = draftMembers.has(input.value); input.disabled = state.busy;
      input.addEventListener('change', () => { if (input.checked) draftMembers.add(input.value); else draftMembers.delete(input.value); });
      row.append(input, node('span', `${sources[p.source]} / ${p.id}`)); groupMembers.append(row);
    }
  }
  function loadGroup() { const g = (state.insights?.groups || []).find(g => g.id === groupEditorId); groupName.value = g?.name || ''; draftMembers = new Set(g?.keys || []); renderMembers(); }
  groupEditor.addEventListener('change', () => { groupEditorId = groupEditor.value; loadGroup(); groupDelete.disabled = state.busy || !groupEditorId; });
  groupForm.addEventListener('submit', event => { event.preventDefault(); if (!state.busy) { pendingGroupSave = true; send('groupSave', { group: { ...(groupEditorId ? { id: groupEditorId } : {}), name: groupName.value, keys: [...draftMembers] } }); } });
  const markerForm = node('form', undefined, 'insight-form'); markerPanel.append(markerForm);
  const markerEditor = field(markerForm, 'Edit release marker', node('select'));
  const markerProduct = field(markerForm, 'Release product', node('select')); markerProduct.required = true;
  const markerDate = field(markerForm, 'Release date (UTC)', node('input')); markerDate.type = 'date'; markerDate.required = true; markerDate.value = new Date().toISOString().slice(0, 10);
  const markerLabel = field(markerForm, 'Release label', node('input')); markerLabel.required = true; markerLabel.maxLength = 80; markerLabel.placeholder = 'e.g. v0.5.0';
  const markerNotes = field(markerForm, 'Release notes (optional)', node('textarea')); markerNotes.maxLength = 500; markerNotes.rows = 3; markerNotes.placeholder = 'What changed? e.g. Fixed slow startup. Up to 500 characters.';
  const markerActions = node('div', undefined, 'insight-actions');
  const markerSave = node('button', 'Save release marker', 'primary'); markerSave.type = 'submit';
  const markerDelete = button('Delete marker', () => send('markerDelete', { id: markerEditorId }), 'ghost');
  markerActions.append(markerSave, markerDelete); markerForm.append(markerActions);
  function loadMarker() { const m = (state.insights?.markers || []).find(m => m.id === markerEditorId); markerProduct.value = m?.key || (state.products[0] ? keyOf(state.products[0]) : ''); markerDate.value = m?.date || state.dateLimits?.today || new Date().toISOString().slice(0, 10); markerLabel.value = m?.label || ''; markerNotes.value = m?.notes || ''; }
  markerEditor.addEventListener('change', () => { markerEditorId = markerEditor.value; loadMarker(); markerDelete.disabled = state.busy || !markerEditorId; });
  markerForm.addEventListener('submit', event => { event.preventDefault(); if (!state.busy) { pendingMarkerSave = true; send('markerSave', { marker: { ...(markerEditorId ? { id: markerEditorId } : {}), key: markerProduct.value, date: markerDate.value, label: markerLabel.value, notes: markerNotes.value } }); } });
  const releaseList = node('section', undefined, 'panel release-list'); releaseList.setAttribute('aria-label', 'Saved release markers'); views.insights.append(releaseList);
  const comparisonPanel = node('section', undefined, 'panel comparison-panel'); views.insights.append(comparisonPanel);
  comparisonPanel.append(node('h2', 'Custom comparisons'), node('p', 'Compare completed UTC days within the last 180 days. npm uses daily data. Other sources use saved observations (up to 90 days); two observations per range are required.', 'fine'));
  const comparisonForm = node('form', undefined, 'comparison-form'); comparisonPanel.append(comparisonForm);
  const comparisonTarget = field(comparisonForm, 'Comparison target', node('select'));
  const dateInputs = {};
  const dayOffset = (value, offset) => { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  const comparisonEnd = dayOffset(new Date().toISOString().slice(0, 10), -1);
  for (const [key, title, value] of [['aStart', 'Range A start (UTC)', dayOffset(comparisonEnd, -6)], ['aEnd', 'Range A end (UTC)', comparisonEnd], ['bStart', 'Range B start (UTC)', dayOffset(comparisonEnd, -13)], ['bEnd', 'Range B end (UTC)', dayOffset(comparisonEnd, -7)]]) {
    const input = field(comparisonForm, title, node('input')); input.type = 'date'; input.required = true; input.value = value; dateInputs[key] = input;
  }
  const compareButton = node('button', 'Compare ranges', 'primary'); compareButton.type = 'submit'; comparisonForm.append(compareButton);
  const comparisonResult = node('div', undefined, 'comparison-result'); comparisonResult.setAttribute('aria-live', 'polite'); comparisonPanel.append(comparisonResult);
  function comparisonRequest() { return { target: comparisonTarget.value, a: { start: dateInputs.aStart.value, end: dateInputs.aEnd.value }, b: { start: dateInputs.bStart.value, end: dateInputs.bEnd.value } }; }
  comparisonForm.addEventListener('submit', event => { event.preventDefault(); if (!state.busy) send('compare', { request: comparisonRequest() }); });
  comparisonForm.addEventListener('input', () => renderComparison()); comparisonTarget.addEventListener('change', () => renderComparison());
  function renderComparison() {
    comparisonResult.replaceChildren(); const report = state.comparison;
    if (!report) { comparisonResult.append(node('p', 'Choose a target and two ranges, then compare. Refreshing data or changing tracked products/groups clears the previous result.', 'fine')); return; }
    if (JSON.stringify(report.request) !== JSON.stringify(comparisonRequest())) { comparisonResult.append(node('p', 'Inputs changed. Compare again to update the result.', 'fine')); return; }
    comparisonResult.append(node('h3', report.targetName), node('p', `A: ${report.request.a.start} to ${report.request.a.end} / B: ${report.request.b.start} to ${report.request.b.end} (UTC)`, 'fine'), node('p', `Computed ${new Date(report.computedAt).toLocaleString()}`, 'fine'));
    if (report.npmTotals) comparisonResult.append(node('p', `npm downloads across ${report.npmTotals.products} selected package(s): A ${fmt(report.npmTotals.a)} / B ${fmt(report.npmTotals.b)}. All selected packages must have complete data.`, 'comparison-total'));
    const wrap = node('div', undefined, 'comparison-table-wrap'), table = node('table'); table.append(node('caption', 'Source metrics remain separate. Difference is A minus B.'));
    const head = node('thead'), header = node('tr'); for (const title of ['Product / metric', 'Range A', 'Range B', 'Difference', 'Percent change']) { const th = node('th', title); th.scope = 'col'; header.append(th); } head.append(header); table.append(head); const body = node('tbody');
    for (const row of report.rows) {
      const tr = node('tr'), productCell = node('td'); productCell.append(node('strong', row.product.id), node('small', `${sources[row.product.source]} / ${row.metric}`)); tr.append(productCell);
      for (const value of [row.a, row.b]) { const td = node('td'); td.append(node('strong', fmt(value.value)), node('small', value.coverage)); if (value.firstAt) td.append(node('small', `${value.firstAt} to ${value.lastAt}`)); tr.append(td); }
      tr.append(node('td', fmt(row.difference)), node('td', row.percent == null ? 'Unavailable' : `${row.percent.toFixed(1)}%`)); body.append(tr);
    }
    table.append(body); wrap.append(table); comparisonResult.append(wrap);
    const notes = node('ul', undefined, 'fine'); for (const note of report.notes) notes.append(node('li', note)); comparisonResult.append(notes);
  }
  function renderInsights() {
    const groups = state.insights?.groups || [], markers = state.insights?.markers || [];
    const signature = JSON.stringify([state.products, groups, markers]);
    if (signature !== insightSignature) {
      insightSignature = signature;
      if (selectedGroupId && !groups.some(g => g.id === selectedGroupId)) { selectedGroupId = ''; persist(); }
      options(groupFilter, [['', 'All tracked products'], ...groups.map(g => [g.id, g.name])], selectedGroupId);
      options(groupEditor, [['', 'New group'], ...groups.map(g => [g.id, g.name])], groupEditorId);
      if (groupEditorId && !groups.some(g => g.id === groupEditorId)) { groupEditorId = ''; loadGroup(); }
      draftMembers = new Set([...draftMembers].filter(key => state.products.some(p => keyOf(p) === key))); renderMembers();
      options(markerEditor, [['', 'New release marker'], ...markers.map(m => [m.id, `${m.date} / ${m.label} / ${m.key}`])], markerEditorId);
      if (markerEditorId && !markers.some(m => m.id === markerEditorId)) { markerEditorId = ''; loadMarker(); }
      options(markerProduct, state.products.map(p => [keyOf(p), `${sources[p.source]} / ${p.id}`]), markerProduct.value);
      options(comparisonTarget, [['all', 'All tracked products'], ...groups.map(g => [`group:${g.id}`, `Group: ${g.name}`]), ...state.products.map(p => [`product:${keyOf(p)}`, `${sources[p.source]}: ${p.id}`])], comparisonTarget.value || 'all');
      releaseList.replaceChildren(node('h2', 'Saved release markers'));
      if (!markers.length) releaseList.append(node('p', 'No release markers yet. Add a dated label above.', 'fine'));
      else {
        const list = node('ul');
        for (const m of [...markers].reverse()) {
          const item = node('li'); item.append(node('span', `${m.date} (UTC) / ${m.label} / ${m.key}`));
          if (m.notes) item.append(node('p', m.notes, 'release-notes fine'));
          const remove = button('Delete release marker', () => { if (!state.busy) send('markerDelete', { id: m.id }); }, 'ghost');
          remove.setAttribute('aria-label', `Delete release marker: ${m.label} / ${m.date} / ${m.key}`);
          item.append(remove); list.append(item);
        }
        releaseList.append(list);
      }
    }
    if (!state.busy && pendingGroupSave) { pendingGroupSave = false; if (state.notice === 'Product group saved.') { groupEditorId = ''; groupEditor.value = ''; loadGroup(); } }
    if (!state.busy && pendingMarkerSave) { pendingMarkerSave = false; if (state.notice === 'Release marker saved.') { markerEditorId = ''; markerEditor.value = ''; loadMarker(); } }
    for (const control of views.insights.querySelectorAll('input, select, textarea, button')) control.disabled = !!state.busy;
    groupDelete.disabled = state.busy || !groupEditorId; markerDelete.disabled = state.busy || !markerEditorId;
    markerSave.disabled = state.busy || !state.products.length; compareButton.disabled = state.busy || !state.products.length; groupFilter.disabled = !!state.busy;
    for (const input of Object.values(dateInputs)) { input.min = state.dateLimits?.start || ''; input.max = state.dateLimits?.end || ''; }
    markerDate.max = state.dateLimits?.today || new Date().toISOString().slice(0, 10);
    renderComparison();
  }
  function markersFor(keys, start, end) { return (state.insights?.markers || []).filter(m => keys.includes(m.key) && m.date >= start && m.date <= end); }
  function markerLegend(markers) { const details = node('details', undefined, 'release-legend'); details.append(node('summary', `Release markers (${markers.length})`)); const list = node('ul'); for (const m of markers) list.append(node('li', `${m.date} (UTC): ${m.label} / ${m.key}`)); details.append(list); return details; }

  const releaseDiscovery=node('section',undefined,'panel comparison-panel');views.insights.append(releaseDiscovery);
  releaseDiscovery.append(node('h2','Discover npm release dates'),node('p','Suggest up to 30 published versions from the last 180 days for one tracked npm package. Review and save each marker yourself. Publication dates may differ from launch dates. Extension releases can still be entered manually.','fine'));
  const releasePackage=field(releaseDiscovery,'Package for release discovery',node('select'));
  const discoverReleases=button('Discover releases',()=>send('releaseDiscover',{key:releasePackage.value}),'ghost');releaseDiscovery.append(discoverReleases);
  const suggestedReleases=node('div',undefined,'release-suggestions');releaseDiscovery.append(suggestedReleases);
  function renderReleaseSuggestions(){
    options(releasePackage,state.products.filter(p=>p.source==='npm').map(p=>[keyOf(p),p.id]),releasePackage.value);
    releasePackage.disabled=!!state.busy;discoverReleases.disabled=state.busy||!releasePackage.value;suggestedReleases.replaceChildren();
    const suggestions=state.releaseSuggestions;if(!suggestions)return;
    suggestedReleases.append(node('p',`Publication dates from npm / ${suggestions.key}. Saving a marker does not create historical observations.`,'fine'));
    if(!suggestions.candidates.length)suggestedReleases.append(node('p','No dated versions found in the last 180 days. Add the actual release date manually.','fine'));
    for(const candidate of suggestions.candidates){
      const item=node('div',undefined,'monitor-item'),label=`v${candidate.version}`;
      item.append(node('strong',`${label} / ${candidate.date} UTC`),node('p',`Published ${candidate.publishedAt}`,'fine'));
      const saved=(state.insights?.markers||[]).some(m=>m.key===suggestions.key&&m.date===candidate.date&&m.label===label);
      const review=button(saved?'Marker already saved':`Review ${label}`,()=>{markerEditorId='';markerEditor.value='';loadMarker();markerProduct.value=suggestions.key;markerDate.value=candidate.date;markerLabel.value=label;markerNotes.value='';setPage('insights');markerNotes.focus();},'ghost');review.disabled=state.busy||saved;item.append(review);suggestedReleases.append(item);
    }
  }
  views.health.append(pageHeading('Keep your history useful.','Collection status, bounded storage, local backups and a weekly progress review.','HEALTH & PROGRESS'));
  const collectionPanel=node('section',undefined,'panel comparison-panel');views.health.append(collectionPanel);
  collectionPanel.append(node('h2','Background collection'),node('p','Opt in to collect while VS Code runs, even with the dashboard closed. Nothing runs after VS Code closes. One window collects in the background for each local VS Code storage profile. Daily collection is the default; frequent collection reaches the 100-observation limit sooner.','fine'));
  const collectionForm=node('form',undefined,'comparison-form collection-form');collectionPanel.append(collectionForm);
  const collectionEnabled=field(collectionForm,'Collect in background',node('input'));collectionEnabled.type='checkbox';
  const collectionMinutes=field(collectionForm,'Collection interval (minutes)',node('input'));collectionMinutes.type='number';collectionMinutes.min='10';collectionMinutes.max='1440';collectionMinutes.step='1';collectionMinutes.required=true;
  const collectionSave=node('button','Save collection settings','primary');collectionSave.type='submit';collectionForm.append(collectionSave);
  let collectionDirty=false,collectionPending=false;
  collectionForm.addEventListener('input',()=>{collectionDirty=true;});collectionForm.addEventListener('change',()=>{collectionDirty=true;});
  collectionForm.addEventListener('submit',event=>{event.preventDefault();if(!state.busy){collectionPending=true;send('collectionSave',{enabled:collectionEnabled.checked,minutes:Number(collectionMinutes.value)});}});
  const collectionStatus=node('div');collectionPanel.append(collectionStatus);
  const storagePanel=node('section',undefined,'panel comparison-panel');views.health.append(storagePanel);storagePanel.append(node('h2','Storage and backups'));
  const storageStatus=node('div');storagePanel.append(storageStatus);
  const backupExport=button('Export backup',()=>send('backupExport'),'ghost'),backupInspect=button('Review backup file',()=>send('backupInspect'),'ghost');storagePanel.append(backupExport,backupInspect);
  const restoreReview=node('div',undefined,'backup-review');storagePanel.append(restoreReview);
  const progressPanel=node('section',undefined,'panel comparison-panel');views.health.append(progressPanel);progressPanel.append(node('h2','Weekly progress'));
  const progressContent=node('div');progressPanel.append(progressContent);
  function renderHealth(){
    const status=state.collection||{};
    if(collectionPending&&!state.busy){collectionPending=false;if(state.notice?.startsWith('Background collection'))collectionDirty=false;}
    if(!collectionDirty){collectionEnabled.checked=!!status.enabled;collectionMinutes.value=String(status.minutes||1440);}
    for(const control of collectionForm.querySelectorAll('input,button'))control.disabled=!!state.busy;
    collectionStatus.replaceChildren(node('p',`${status.enabled?'Enabled':'Disabled'} / Last attempt: ${status.lastAttemptAt||'none'} / Last successful source fetch: ${status.lastSuccessAt||'none'}.`,'fine'));
    if(status.error)collectionStatus.append(node('p',status.error,'error'));
    const storage=state.storage;storageStatus.replaceChildren();
    if(storage){storageStatus.append(node('p',`${fmt(storage.bytes)} bytes serialized / ${fmt(storage.snapshots)} retained snapshots.`, 'storage-size'),node('p',`Limits: ${storage.maxProducts} products; ${storage.perProduct} observations per product; ${storage.days}-day age limit. More frequent collection shortens effective history.`, 'fine'),node('p',storage.note,'fine'));if(storage.warning)storageStatus.append(node('p',storage.warning,'error'));}
    backupExport.disabled=backupInspect.disabled=!!state.busy;restoreReview.replaceChildren();
    const backup=state.backupReview;
    if(backup){restoreReview.append(node('h3','Review before restoring'),node('p',`Backup created ${backup.createdAt}: ${backup.products} products, ${backup.snapshots} retained observations, ${backup.groups} groups, ${backup.markers} markers and ${backup.rules} rules.`),node('p','Restoring replaces your tracked products, saved history, groups, release markers, rules and alerts. Export your current backup first. Credentials and collection settings are excluded. Expired observations and alerts are pruned.','fine'));
      const apply=button('Replace local data with this backup',()=>send('backupRestore',{id:backup.id}),'primary'),cancel=button('Cancel restore',()=>send('backupCancel'),'ghost');apply.disabled=cancel.disabled=!!state.busy;restoreReview.append(apply,cancel);}
    progressContent.replaceChildren();const progress=state.progress;if(!progress)return;
    progressContent.append(node('p',`${progress.start} to ${progress.end} UTC / ${progress.milestones} milestone alerts in the last 7 days / ${progress.failures} source failures in the latest refresh.`,'fine'),node('p','npm compares 7 completed days with the preceding 7. Other sources show actual saved observations inside the week. Values are not unique users and are never summed across source types.','fine'));
    if(!progress.rows.length){progressContent.append(node('p','Track products and collect data to build your progress review.','fine'));return;}
    const wrap=node('div',undefined,'comparison-table-wrap'),table=node('table');table.append(node('caption',`Weekly progress computed ${progress.computedAt}`));const head=node('thead'),header=node('tr');for(const label of ['Product / metric','Value','Change','Coverage / health']){const th=node('th',label);th.scope='col';header.append(th);}head.append(header);table.append(head);const body=node('tbody');
    for(const row of progress.rows){const tr=node('tr'),name=node('td'),coverage=node('td');name.append(node('strong',`${row.product.source} / ${row.product.id}`),node('small',row.meaning));coverage.append(node('span',row.coverage),node('small',`${row.health} / As of ${row.asOf||'unavailable'}`));tr.append(name,node('td',fmt(row.value)),node('td',fmt(row.difference)),coverage);body.append(tr);}table.append(body);wrap.append(table);progressContent.append(wrap);
  }

  views.launch.append(pageHeading('Review your next chapter.', 'Compare a release, track milestones and export an honest progress card.', 'LAUNCH REVIEW'));
  const alertBadge = node('span', '', 'alert-badge'); alertBadge.hidden = true; alertBadge.title = 'Unread monitoring alerts'; navButtons.launch.append(alertBadge);
  const launchPanel = node('section', undefined, 'panel comparison-panel'); views.launch.append(launchPanel);
  launchPanel.append(node('h2', 'Before and after a release'), node('p', 'Select a saved release and equal completed UTC windows. The release day is included in After. A report shows association, not causation.', 'fine'));
  const launchForm = node('form', undefined, 'comparison-form launch-form'); launchPanel.append(launchForm);
  const launchMarker = field(launchForm, 'Launch release marker', node('select')); launchMarker.required = true;
  const launchMarkerHelp = node('p', '', 'fine'); launchMarkerHelp.id = 'launch-marker-help'; launchMarkerHelp.setAttribute('aria-live', 'polite');
  launchMarker.setAttribute('aria-describedby', launchMarkerHelp.id);
  let creatingLaunchMarker;
  const addLaunchMarker = button('Add release marker', () => {
    markerEditorId = ''; markerEditor.value = ''; loadMarker();
    const key = launchTarget.value.startsWith('product:') ? launchTarget.value.slice(8) : '';
    if (state.products.some(p => keyOf(p) === key)) markerProduct.value = key;
    creatingLaunchMarker = new Set((state.insights?.markers || []).map(m => m.id)); setPage('insights'); markerLabel.focus();
  }, 'ghost');
  launchPanel.append(launchMarkerHelp, addLaunchMarker);
  const launchTarget = field(launchForm, 'Launch target', node('select')); launchTarget.required = true;
  const launchDays = field(launchForm, 'Days before and after', node('select')); options(launchDays, [7, 14, 30, 60].map(n => [String(n), `${n} days each`]), '7');
  const launchMode = field(launchForm, 'Review mode', node('select')); options(launchMode, [['complete', 'Completed window'], ['early', 'Early review (preliminary until complete)']], 'complete');
  const launchReadiness = node('p', '', 'launch-readiness fine'); launchReadiness.setAttribute('role', 'status'); launchPanel.append(launchReadiness);
  const availabilityBox=node('div',undefined,'launch-availability');availabilityBox.setAttribute('aria-live','polite');launchPanel.append(availabilityBox);
  let availabilityKey='',availabilityId='',availabilitySequence=0;
  function inspectAvailability(ready){
    const key=JSON.stringify([launchRequest(),state.insights?.markers,state.history?.length,state.history?.at(-1)?.fetchedAt,state.readings.map(r=>[keyOf(r.product),r.fetchedAt,r.error,r.health])]);
    if(!ready){availabilityKey='';availabilityId='';availabilityBox.replaceChildren(node('p','Data availability will be assessed when a completed-day window is ready.','fine'));return;}
    if(key===availabilityKey||state.busy||pendingLaunch)return;
    availabilityKey=key;availabilityId=String(++availabilitySequence);availabilityBox.replaceChildren(node('p','Checking data coverage for these windows…','fine'));send('launchInspect',{requestId:availabilityId,request:launchRequest()});
  }
  const reviewButton = node('button', 'Review launch', 'primary'); reviewButton.type = 'submit'; launchForm.append(reviewButton);
  let pendingLaunch = false;
  function launchRequest() { return { markerId: launchMarker.value, target: launchTarget.value, days: Number(launchDays.value), ...(launchMode.value === 'early' ? { mode: 'early' } : {}) }; }
  launchForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!reviewButton.disabled && !state.busy && !pendingLaunch && (state.insights?.markers || []).some(m => m.id === launchMarker.value)) {
      pendingLaunch = true; renderLaunchReport(); send('launchReview', { request: launchRequest() });
    }
  });
  launchMarker.addEventListener('change', () => { const marker = (state.insights?.markers || []).find(m => m.id === launchMarker.value); if (marker) launchTarget.value = `product:${marker.key}`; renderLaunchReport(); });
  launchForm.addEventListener('change', () => renderLaunchReport());
  const launchResult = node('div', undefined, 'launch-result'); launchResult.setAttribute('aria-live', 'polite'); launchPanel.append(launchResult);
  const launchExports = node('div', undefined, 'launch-exports'); launchPanel.append(launchExports);
  const cardType = field(launchExports, 'Card type', node('select'));options(cardType,[['comparison','Release comparison'],['current','Current total / count']],'comparison');
  const currentProduct = field(launchExports,'Current-card product',node('select'));
  const currentPeriod = field(launchExports,'Current npm window',node('select'));options(currentPeriod,[7,30,90].map(n=>[String(n),`${n} completed days`]),'30');
  const cardMetric = field(launchExports, 'Share-card metric', node('select'));
  const reportExport = button('Export report (Markdown)', () => send('launchExport', { format: 'md' }), 'ghost');
  function cardRequest() {return cardType.value==='current'?{cardType:'current',key:currentProduct.value,days:Number(currentPeriod.value)}:{metric:cardMetric.value};}
  const svgExport = button('Export card (SVG)', () => send('launchExport', { format: 'svg', ...cardRequest() }), 'ghost');
  const pngExport = button('Export card (PNG)', () => send('launchShare', cardRequest()), 'primary');
  launchExports.append(reportExport, svgExport, pngExport);
  const cardHelp=node('p','','fine');launchPanel.append(cardHelp);
  const useCurrent=button('Use a current-total card',()=>{cardType.value='current';const key=cardMetric.value.startsWith('product:')?cardMetric.value.slice(8):launchTarget.value.startsWith('product:')?launchTarget.value.slice(8):currentProduct.value;if(state.products.some(p=>keyOf(p)===key))currentProduct.value=key;renderCardControls();},'ghost');launchPanel.append(useCurrent);
  const cardPreview = node('figure', undefined, 'launch-card-preview'); cardPreview.hidden = true;
  const previewCaption = node('figcaption', 'Share-card preview'); const previewImage = node('img'); previewImage.alt = 'Launch review share-card preview';
  cardPreview.append(previewCaption); launchPanel.append(cardPreview);
  let previewKey = '', previewId = '', previewSequence = 0;
  function resetCardPreview() { previewKey = ''; previewId = ''; cardPreview.hidden = true; previewImage.removeAttribute('src'); previewImage.remove(); }
  function updateCardPreview() {
    const report = currentLaunchReport(); if (!canPreviewCard() || pendingLaunch) { resetCardPreview(); return; }
    const key = JSON.stringify([cardRequest(),cardType.value==='current'?state.readings.find(r=>keyOf(r.product)===currentProduct.value)?.fetchedAt:[launchRequest(),report?.comparison.computedAt]]);
    if (key === previewKey || state.busy) return;
    previewKey = key; previewId = String(++previewSequence); cardPreview.hidden = false; previewImage.removeAttribute('src'); previewImage.remove(); previewCaption.textContent = 'Preparing share-card preview…';
    send('launchPreview', { requestId: previewId, ...cardRequest() });
  }
  function canPreviewCard() {
    if(cardType.value==='current'){
      const r=state.readings.find(r=>keyOf(r.product)===currentProduct.value);
      if(!r || r.error || !r.metric || !['fresh','cached','partial'].includes(r.health))return false;
      return r.metric.kind==='count' || r.metric.windows.some(w=>w.days===Number(currentPeriod.value)&&w.total!==null);
    }
    const report=currentLaunchReport();if(!report)return false;
    const pair=cardMetric.value==='npm-total'?report.comparison.npmTotals:report.comparison.rows.find(r=>`product:${keyOf(r.product)}`===cardMetric.value);
    if(!pair)return false;return cardMetric.value==='npm-total'?pair.a!==null||pair.b!==null:pair.a.value!==null||pair.b.value!==null;
  }
  function renderCardControls(){
    const report=currentLaunchReport(),current=cardType.value==='current',blocked=state.busy||pendingLaunch;
    cardType.disabled=!!blocked;currentProduct.disabled=blocked||!current||!state.products.length;
    currentProduct.parentElement.hidden=!current;currentPeriod.parentElement.hidden=!current||!currentProduct.value.startsWith('npm:');cardMetric.parentElement.hidden=current;
    currentPeriod.disabled=blocked||!current||!currentProduct.value.startsWith('npm:');cardMetric.disabled=blocked||current||!report;
    reportExport.disabled=blocked||!report;svgExport.disabled=pngExport.disabled=blocked||!canPreviewCard();useCurrent.disabled=!!blocked||!state.products.length;
    cardHelp.textContent=current&&!canPreviewCard()?'Refresh the selected product for a fresh source value, or choose an npm window with complete coverage.':current?'Current cards show a fresh source count or a chosen npm rolling window, with its observation time. They are not release comparisons or unique-user counts.':!report?'Generate a review for a comparison card, or choose Current total / count to share a current metric.':!canPreviewCard()?'No historical values in either window for this metric. Comparison-card export is disabled. Choose a current-total card or collect observations for a future release.':'Comparison cards show the available window values. Missing values and coverage remain explicit.';
    updateCardPreview();
  }
  for(const control of [cardMetric,cardType,currentProduct,currentPeriod])control.addEventListener('change',renderCardControls);
  function currentLaunchReport() { const report = state.launchReport; return report && report.marker.id === launchMarker.value && report.days === Number(launchDays.value) && (report.mode || 'complete') === launchMode.value && report.comparison.request.target === launchTarget.value ? report : undefined; }
  function renderLaunchReport() {
    launchResult.replaceChildren(); const report = currentLaunchReport();
    const marker = (state.insights?.markers || []).find(m => m.id === launchMarker.value), planned = Number(launchDays.value);
    let ready = false;
    if (marker) {
      const today = state.dateLimits?.today || new Date().toISOString().slice(0, 10);
      const completed = Math.max(0, Math.floor((Date.parse(today) - Date.parse(marker.date)) / 86400000)), elapsed = Math.min(planned, completed);
      ready = launchMode.value === 'early' ? elapsed > 0 : completed >= planned;
      launchReadiness.textContent = `${elapsed} of ${planned} days completed. Full review available ${dayOffset(marker.date, planned)} UTC. ` + (launchMode.value === 'early' ? elapsed ? `Early review uses ${elapsed} completed days in each window${elapsed < planned ? ' and is preliminary' : ''}.` : `Early review available ${dayOffset(marker.date, 1)} UTC, after the first day completes.` : completed < planned ? 'Select Early review to compare the days completed so far.' : 'The selected window is complete.');
    } else launchReadiness.textContent = 'Save a release marker to see window readiness.';
    reviewButton.textContent = pendingLaunch ? 'Reviewing launch…' : 'Review launch';
    reviewButton.disabled = state.busy || pendingLaunch || !ready;
    renderCardControls();inspectAvailability(ready);
    if (pendingLaunch) { launchResult.append(node('p', 'Generating your launch review…', 'fine')); return; }
    const failure = state.launchReviewError;
    if (failure && failure.request?.markerId === launchMarker.value && failure.request?.target === launchTarget.value && failure.request?.days === Number(launchDays.value) && (failure.request?.mode || 'complete') === launchMode.value) {
      const error = node('p', failure.message, 'error'); error.setAttribute('role', 'alert'); launchResult.append(error); return;
    }
    if (!report) { launchResult.append(node('p', state.launchReport ? 'Inputs changed. Review the launch again before exporting.' : 'Choose a completed launch window and review it. Refresh or metadata changes clear the previous report.', 'fine')); return; }
    const c = report.comparison;
    if (report.preliminary) launchResult.append(node('p', `PRELIMINARY · ${report.actualDays} of ${report.days} planned days. Equal completed-day windows; results may change.`, 'preliminary-banner'));
    if (report.marker.notes) launchResult.append(node('p', report.marker.notes, 'release-notes'));
    launchResult.append(node('h3', `${c.targetName} / ${report.marker.label}`), node('p', `After: ${c.request.a.start} to ${c.request.a.end} / Before: ${c.request.b.start} to ${c.request.b.end} (UTC)`, 'fine'), node('p', `Computed ${new Date(c.computedAt).toLocaleString()}`, 'fine'));
    if (c.npmTotals) launchResult.append(node('p', `npm downloads across ${c.npmTotals.products} package(s): After ${fmt(c.npmTotals.a)} / Before ${fmt(c.npmTotals.b)}. Complete coverage is required.`, 'comparison-total'));
    const wrap = node('div', undefined, 'comparison-table-wrap'), table = node('table'); table.append(node('caption', 'Release comparison: source metrics stay separate. Difference is After minus Before.'));
    const head = node('thead'), headers = node('tr'); for (const title of ['Product / metric', 'After', 'Before', 'Difference', 'Percent change']) { const th = node('th', title); th.scope = 'col'; headers.append(th); } head.append(headers); table.append(head); const body = node('tbody');
    for (const row of c.rows) {
      const tr = node('tr'), name = node('td'); name.append(node('strong', row.product.id), node('small', `${sources[row.product.source]} / ${row.metric}`)); tr.append(name);
      for (const period of [row.a, row.b]) { const td = node('td'); td.append(node('strong', fmt(period.value)), node('small', period.coverage)); if (period.firstAt) td.append(node('small', `${period.firstAt} to ${period.lastAt}`)); tr.append(td); }
      tr.append(node('td', fmt(row.difference)), node('td', row.percent === null ? 'Unavailable' : `${row.percent.toFixed(1)}%`)); body.append(tr);
    }
    table.append(body); wrap.append(table); launchResult.append(wrap);
    const notes = node('ul', undefined, 'fine'); for (const note of c.notes) notes.append(node('li', note)); launchResult.append(notes);
    options(cardMetric, [...(c.npmTotals ? [['npm-total', 'Combined npm downloads only']] : []), ...c.rows.map(row => [`product:${keyOf(row.product)}`, `${sources[row.product.source]} / ${row.product.id}`])], cardMetric.value);
    for (const series of report.daily || []) launchResult.append(launchComparisonChart(series));
    renderCardControls();
  }
  const monitorPanel = node('section', undefined, 'panel comparison-panel'); views.launch.append(monitorPanel);
  monitorPanel.append(node('h2', 'Milestones and alerts'), node('p', 'Rules run on fresh source fetches, not cache hits (the 10-minute source cache applies). Change alerts have a one-hour cooldown and need a positive baseline. Editing a rule resets its baseline and rearms milestones. Nothing runs while VS Code is closed.', 'fine'));
  const ruleForm = node('form', undefined, 'comparison-form rule-form'); monitorPanel.append(ruleForm);
  const ruleEditor = field(ruleForm, 'Edit monitoring rule', node('select'));
  const ruleName = field(ruleForm, 'Rule name', node('input')); ruleName.required = true; ruleName.maxLength = 60;
  const ruleProduct = field(ruleForm, 'Monitoring product', node('select')); ruleProduct.required = true;
  const ruleMetric = field(ruleForm, 'Monitoring metric', node('select')); ruleMetric.required = true;
  const ruleKind = field(ruleForm, 'Rule kind', node('select')); options(ruleKind, [['milestone', 'Milestone: count at least'], ['increase', 'Increase since previous fetch (%)'], ['decrease', 'Decrease since previous fetch (%)']], 'milestone');
  const ruleThreshold = field(ruleForm, 'Threshold (count or percent)', node('input')); ruleThreshold.type = 'number'; ruleThreshold.min = '0.01'; ruleThreshold.step = 'any'; ruleThreshold.required = true; ruleThreshold.value = '1000';
  const ruleEnabled = field(ruleForm, 'Rule enabled', node('input')); ruleEnabled.type = 'checkbox'; ruleEnabled.checked = true;
  const ruleActions = node('div', undefined, 'insight-actions'); ruleForm.append(ruleActions);
  const ruleSave = node('button', 'Save monitoring rule', 'primary'); ruleSave.type = 'submit';
  let ruleEditorId = '', pendingRuleSave = false, launchSignature = '';
  const ruleDelete = button('Delete monitoring rule', () => send('ruleDelete', { id: ruleEditorId }), 'ghost'); ruleActions.append(ruleSave, ruleDelete);
  function monitoringMetricLabel(metric) { return metric === 'count' ? 'Source count' : `npm ${metric.slice(3)}-day rolling total`; }
  function metricOptions(selected) { const product = state.products.find(p => keyOf(p) === ruleProduct.value); const metrics = product?.source === 'npm' ? ['npm7', 'npm30', 'npm90'] : ['count']; options(ruleMetric, metrics.map(metric => [metric, monitoringMetricLabel(metric)]), selected || (product?.source === 'npm' ? 'npm30' : 'count')); }
  function loadRule() { const rule = (state.monitoring?.rules || []).find(r => r.id === ruleEditorId); ruleName.value = rule?.name || ''; ruleProduct.value = rule?.key || (state.products[0] ? keyOf(state.products[0]) : ''); metricOptions(rule?.metric); ruleKind.value = rule?.kind || 'milestone'; ruleThreshold.value = String(rule?.threshold ?? 1000); ruleEnabled.checked = rule?.enabled ?? true; }
  ruleEditor.addEventListener('change', () => { ruleEditorId = ruleEditor.value; loadRule(); ruleDelete.disabled = state.busy || !ruleEditorId; });
  ruleProduct.addEventListener('change', () => metricOptions());
  ruleForm.addEventListener('submit', event => { event.preventDefault(); if (!state.busy) { pendingRuleSave = true; send('ruleSave', { rule: { ...(ruleEditorId ? { id: ruleEditorId } : {}), name: ruleName.value, key: ruleProduct.value, metric: ruleMetric.value, kind: ruleKind.value, threshold: Number(ruleThreshold.value), enabled: ruleEnabled.checked } }); } });
  const ruleList = node('div', undefined, 'monitor-rules'); monitorPanel.append(ruleList);
  const alertPanel = node('section', undefined, 'panel comparison-panel'); views.launch.append(alertPanel);
  const alertSummary = node('h2', 'Alerts'); alertPanel.append(alertSummary);
  const acknowledgeAll = button('Mark all alerts read', () => send('alertAck', { id: 'all' }), 'ghost'); alertPanel.append(acknowledgeAll);
  const alertFeed = node('div', undefined, 'alerts-feed'); alertFeed.setAttribute('aria-live', 'polite'); alertPanel.append(alertFeed);
  function renderLaunch() {
    const groups = state.insights?.groups || [], markers = state.insights?.markers || [], rules = state.monitoring?.rules || [], alerts = state.monitoring?.alerts || [];
    const signature = JSON.stringify([state.products, groups, markers, rules]);
    if (signature !== launchSignature) {
      launchSignature = signature;
      options(launchMarker, markers.length ? markers.map(m => [m.id, `${m.date} / ${m.label} / ${m.key}`]) : [['', 'No release markers saved']], launchMarker.value);
      options(currentProduct,state.products.map(p=>[keyOf(p),`${sources[p.source]} / ${p.id}`]),currentProduct.value);
      const marker = markers.find(m => m.id === launchMarker.value);
      options(launchTarget, [['all', 'All tracked products'], ...groups.map(g => [`group:${g.id}`, `Group: ${g.name}`]), ...state.products.map(p => [`product:${keyOf(p)}`, `${sources[p.source]} / ${p.id}`])], launchTarget.value || (marker ? `product:${marker.key}` : 'all'));
      options(ruleEditor, [['', 'New monitoring rule'], ...rules.map(r => [r.id, `${r.name} / ${r.key}`])], ruleEditorId);
      if (ruleEditorId && !rules.some(r => r.id === ruleEditorId)) { ruleEditorId = ''; loadRule(); }
      options(ruleProduct, state.products.map(p => [keyOf(p), `${sources[p.source]} / ${p.id}`]), ruleProduct.value); metricOptions(ruleMetric.value);
      ruleList.replaceChildren();
      if (!rules.length) ruleList.append(node('p', 'No monitoring rules yet. Save a milestone or percent-change rule above.', 'fine'));
      for (const rule of rules) {
        const item = node('div', undefined, 'monitor-item');
        item.append(node('strong', rule.name), node('p', `${rule.key} / ${monitoringMetricLabel(rule.metric)} / ${rule.kind} ${fmt(rule.threshold)}${rule.kind === 'milestone' ? '' : '%'}`, 'fine'), node('p', `${!rule.enabled ? 'Paused' : rule.reached ? 'Milestone reached' : 'Monitoring'} / Last value: ${fmt(rule.lastValue)}${rule.lastSampleAt ? ' / ' + rule.lastSampleAt : ' / Awaiting a fresh fetch'}`, 'fine'));
        const remove = button('Delete rule', () => { if (!state.busy) send('ruleDelete', { id: rule.id }); }, 'ghost');
        remove.setAttribute('aria-label', `Delete monitoring rule: ${rule.name}`); item.append(remove); ruleList.append(item);
      }
    }
    if (creatingLaunchMarker && !state.busy && state.notice === 'Release marker saved.') {
      const marker = markers.find(m => !creatingLaunchMarker.has(m.id));
      if (marker) { creatingLaunchMarker = undefined; launchMarker.value = marker.id; launchTarget.value = `product:${marker.key}`; setPage('launch'); }
    }
    if (!state.busy && pendingRuleSave) { pendingRuleSave = false; if (state.notice?.startsWith('Monitoring rule saved.')) { ruleEditorId = ''; ruleEditor.value = ''; loadRule(); } }
    for (const control of views.launch.querySelectorAll('input, select, button')) control.disabled = !!state.busy;
    ruleSave.disabled = state.busy || !state.products.length; ruleDelete.disabled = state.busy || !ruleEditorId; reviewButton.disabled = state.busy || !markers.length;
    launchMarker.disabled = state.busy || !markers.length;
    addLaunchMarker.disabled = state.busy || !state.products.length;
    launchMarkerHelp.textContent = !state.products.length ? 'Track a product first, then add its release date and label.' : !markers.length ? 'No release markers yet. Click Add release marker to save a product, release date and label in Insights. Releases are not imported automatically.' : 'Saved in Insights. Add another marker using its release date and label. Before/after windows must be completed before reviewing.';
    const unread = alerts.filter(a => !a.acknowledged).length; alertBadge.textContent = String(unread); alertBadge.hidden = !unread;
    alertSummary.textContent = `Alerts (${unread} unread)`; acknowledgeAll.disabled = state.busy || !unread;
    alertFeed.replaceChildren();
    if (!alerts.length) alertFeed.append(node('p', 'No triggered alerts. Up to 100 alerts are retained for 90 days. Alerts appear here only; nothing is posted or emailed.', 'fine'));
    for (const alert of [...alerts].reverse()) {
      const item = node('article', undefined, `monitor-item ${alert.acknowledged ? 'alert-read' : 'alert-unread'}`);
      item.append(node('strong', alert.name), node('p', `${alert.kind} / ${alert.key} / ${monitoringMetricLabel(alert.metric)} / Value ${fmt(alert.value)} / Threshold ${fmt(alert.threshold)}${alert.kind === 'milestone' ? '' : '%'}`, 'fine'), node('p', `Triggered ${alert.createdAt}${alert.previousAt ? ' / Previous value ' + fmt(alert.previousValue) + ' at ' + alert.previousAt : ''}`, 'fine'));
      const acknowledge = button(alert.acknowledged ? 'Read' : 'Mark alert read', () => send('alertAck', { id: alert.id }), 'ghost'); acknowledge.disabled = state.busy || alert.acknowledged; item.append(acknowledge); alertFeed.append(item);
    }
    renderLaunchReport();
  }
  function launchComparisonChart(series) {
    const section = node('section', undefined, 'launch-comparison-chart');
    section.append(node('h4', `Daily npm comparison / ${series.product.id}`), node('p', 'Same vertical scale in both windows. Gaps are missing data, not zero. Day 1 is the start of each window.', 'fine'));
    const values = [...series.before, ...series.after].map(d => d.downloads).filter(n => Number.isFinite(n)), max = Math.max(1, ...values);
    const grid = node('div', undefined, 'launch-chart-grid'); section.append(grid);
    for (const [label, points, color] of [['Before', series.before, 'var(--vscode-charts-blue, #4472c4)'], ['After', series.after, 'var(--vscode-charts-green, #008b72)']]) {
      const pane = node('div'); pane.append(node('strong', label), node('p', `0–${fmt(max)} downloads / day`, 'fine'));
      const chart = svgNode('svg', { viewBox: '0 0 480 180', role: 'img', 'aria-label': `${label} daily downloads for ${series.product.id}; gaps indicate missing data` });
      const title = svgNode('title'); title.textContent = `${label}: ${points[0]?.day || ''} to ${points.at(-1)?.day || ''}. Shared scale 0 to ${max}.`; chart.append(title);
      for (const y of [12, 87, 162]) chart.append(svgNode('line', { x1: 12, x2: 468, y1: y, y2: y, class: 'chart-grid' }));
      let segment = [];
      const flush = () => { if (segment.length) chart.append(svgNode('polyline', { points: segment.join(' '), fill: 'none', stroke: color, 'stroke-width': 3 })); segment = []; };
      points.forEach((point, i) => {
        if (point.downloads === null) { flush(); return; }
        const x = points.length === 1 ? 240 : 12 + i / (points.length - 1) * 456, y = 162 - point.downloads / max * 150;
        segment.push(`${x},${y}`);
        const dot = svgNode('circle', { cx: x, cy: y, r: 3, fill: color }); const tip = svgNode('title'); tip.textContent = `${point.day} UTC: ${fmt(point.downloads)} downloads`; dot.append(tip); chart.append(dot);
      }); flush(); pane.append(chart, node('p', `${points[0]?.day || ''} → ${points.at(-1)?.day || ''} UTC`, 'fine')); grid.append(pane);
    }
    const details = node('details'), table = node('table'); details.append(node('summary', 'Compare daily values')); table.append(node('caption', `Daily download values for ${series.product.id}; dates are UTC`));
    const head = node('thead'), tr = node('tr'); for (const label of ['Day', 'Before date', 'Downloads', 'After date', 'Downloads']) { const th = node('th', label); th.scope = 'col'; tr.append(th); } head.append(tr); table.append(head);
    const body = node('tbody'); series.after.forEach((point, i) => { const row = node('tr'), before = series.before[i]; for (const value of [String(i + 1), before?.day || '', fmt(before?.downloads), point.day, fmt(point.downloads)]) row.append(node('td', value)); body.append(row); });
    table.append(body); const wrap = node('div', undefined, 'comparison-table-wrap'); wrap.append(table); details.append(wrap); section.append(details); return section;
  }
  function renderShareCard(message) {
    if (typeof message.svg !== 'string' || message.svg.length > 50000 || typeof message.requestId !== 'string') return;
    const image = new Image();
    image.onerror = () => send('shareCardError', { requestId: message.requestId });
    image.onload = () => {
      try { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630; const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable'); context.drawImage(image, 0, 0, 1200, 630); const data = canvas.toDataURL('image/png'); if (!data.startsWith('data:image/png;base64,')) throw new Error('PNG unavailable'); send('saveShareCard', { requestId: message.requestId, data: data.slice('data:image/png;base64,'.length) }); }
      catch { send('shareCardError', { requestId: message.requestId }); }
    };
    try { image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(message.svg); }
    catch { send('shareCardError', { requestId: message.requestId }); }
  }

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
  function sparkline(daily, days, end, large = false, markers = []) {
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
    const start = dayOffset(end, -days + 1);
    for (const marker of markers) {
      const x = (Date.parse(marker.date) - Date.parse(start)) / 86400000 / (days - 1) * 480;
      const line = svgNode('line', { x1: x, x2: x, y1: top, y2: bottom, class: 'release-marker' });
      const title = svgNode('title'); title.textContent = `${marker.date}: ${marker.label} / ${marker.key}`; line.append(title); svg.append(line);
    }
    chart.append(svg); return chart;
  }
  function dateBounds(end, days) {
    const first = new Date(`${end}T00:00:00Z`); first.setUTCDate(first.getUTCDate() - days + 1);
    const bounds = node('div', undefined, 'chart-bounds'); bounds.append(node('span', first.toISOString().slice(0, 10)), node('span', 'UTC', 'chart-unit'), node('span', end)); return { bounds, start: first.toISOString().slice(0, 10) };
  }
  function appendHistory(card, p, reading) {
    const observations = (state.history || []).filter(s => keyOf(s.product) === keyOf(p));
    const latest = observations.at(-1), previous = observations.at(-2);
    const value = s => !s ? null : s.metric.kind === 'count' ? s.metric.value : s.metric.totals[period];
    const current = value(latest), before = value(previous);
    let copy = 'Two successful observations are needed to show a change.';
    if (latest && previous && current != null && before != null) {
      const delta = current - before;
      copy = `${delta >= 0 ? '+' : ''}${fmt(delta)} since previous successful fetch (${new Date(previous.fetchedAt).toLocaleString()}).`;
      if (p.source === 'npm') copy += ` Change in the rolling ${period}-day total, not new downloads.`;
      else copy += ' Observed counts may decrease.';
    } else if (previous && (current == null || before == null)) copy = 'Change unavailable: an observation has incomplete data.';
    const delta = node('p', copy, 'observation-change fine');
    if (reading?.error && latest) delta.prepend(document.createTextNode('Last saved change: '));
    card.append(delta);
    const details = node('details', undefined, 'observation-history');
    details.append(node('summary', `Saved observations (${observations.length})`));
    if (!observations.length) details.append(node('p', 'No saved observations yet. A successful source fetch starts history.', 'fine'));
    else {
      const wrap = node('div', undefined, 'table-wrap'), table = node('table');
      table.append(node('caption', p.source === 'npm' ? `Saved rolling ${period}-day download totals` : 'Local observations; no collection while VS Code is closed'));
      const head = node('thead'), headers = node('tr');
      for (const text of ['Observed (UTC)', p.source === 'npm' ? 'Data ends (UTC)' : 'Metric', 'Value']) { const th = node('th', text); th.scope = 'col'; headers.append(th); }
      head.append(headers); table.append(head); const body = node('tbody');
      for (const s of [...observations].reverse()) {
        const row = node('tr'); row.append(node('td', s.fetchedAt), node('td', s.metric.kind === 'npm' ? s.metric.end : p.source === 'reddit' ? 'Comments' : p.source === 'marketplace' ? 'Installs' : 'Downloads'), node('td', fmt(value(s)))); body.append(row);
      }
      table.append(body); wrap.append(table); details.append(wrap);
    }
    card.append(details);
  }
  function renderAnalytics() {
    exportCsv.disabled = state.busy || !(state.history || []).length;
    for (const b of periods.children) { const active = Number(b.dataset.days) === period; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }
    for (const b of sourceFilters.children) { const active = b.dataset.source === sourceFilter; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); }
    for (const source of Object.keys(sources)) {
      const count = state.products.filter(p => p.source === source).length; sourceCounts[source].textContent = String(count);
      if (integrationCounts[source]) integrationCounts[source].textContent = `${count} tracked`;
    }
    cards.replaceChildren(); summary.replaceChildren(); activity.replaceChildren();
    const group = (state.insights?.groups || []).find(g => g.id === selectedGroupId);
    const scopedProducts = group ? state.products.filter(p => group.keys.includes(keyOf(p))) : state.products;
    groupScope.textContent = group ? `Group: ${group.name}. Totals, chart and cards cover this group's products. Other sources remain separate from npm downloads.` : 'All tracked products. Text and source filters affect cards; totals cover all npm packages in this scope.';
    const npmProducts = scopedProducts.filter(p => p.source === 'npm'), trackedKeys = new Set(scopedProducts.map(keyOf));
    const valid = state.readings.filter(r => trackedKeys.has(keyOf(r.product)) && r.metric?.kind === 'npm' && !r.error && r.health !== 'outdated' && r.metric.windows.find(w => w.days === period)?.total != null);
    const total = valid.reduce((n, r) => n + r.metric.windows.find(w => w.days === period).total, 0);
    const heroStat = node('div', undefined, 'hero-stat panel'); heroStat.append(node('div', `NPM DOWNLOADS · LAST ${period} DAYS`, 'eyebrow'), node('strong', valid.length ? fmt(total) : '—', 'summary-total'));
    heroStat.append(node('p', npmProducts.length ? `${valid.length} of ${npmProducts.length} npm packages with complete, current data. ${valid.length !== npmProducts.length ? 'Total is partial.' : ''}` : 'Choose npm packages to start seeing download trends.', 'fine'));
    summary.append(heroStat);
    const errors = state.readings.filter(r => trackedKeys.has(keyOf(r.product)) && (r.error || ['partial', 'outdated'].includes(r.health))).length;
    for (const [label, value, caption, glyph] of [
      ['Tracked products', scopedProducts.length, 'Across your connected sources', '◇'],
      ['Reporting packages', `${valid.length}/${npmProducts.length}`, 'Complete npm data this period', '↗'],
      ['Need attention', errors, errors ? 'Check the source message on each card' : 'No source errors reported', '◌']
    ]) { const stat = node('div', undefined, 'stat-card panel'); stat.append(node('span', glyph, 'stat-icon'), node('span', label, 'muted'), node('strong', String(value), 'stat-value'), node('small', caption, 'fine')); summary.append(stat); }
    const activityTop = node('div', undefined, 'activity-top'); const activityCopy = node('div'); activityCopy.append(node('h2', 'Download activity'), node('p', 'Daily npm downloads from packages with complete data.', 'muted')); activityTop.append(activityCopy, node('span', `${period} DAYS · UTC`, 'subtle-badge')); activity.append(activityTop);
    // Keep a common date range when a fetch straddles UTC midnight.
    const end = valid.map(r => r.metric.end).sort().at(-1);
    const aligned = valid.filter(r => r.metric.end === end);
    if (aligned.length) {
      const sums = new Map(); for (const r of aligned) for (const d of r.metric.daily) sums.set(d.day, (sums.get(d.day) || 0) + d.downloads);
      const bounds = dateBounds(end, period), markers = markersFor(aligned.map(r => keyOf(r.product)), bounds.start, end);
      activity.append(sparkline([...sums].map(([day, downloads]) => ({ day, downloads })), period, end, true, markers), bounds.bounds);
      if (markers.length) activity.append(markerLegend(markers));
      activity.append(node('p', `${aligned.length} reporting npm package${aligned.length === 1 ? '' : 's'} · Other source metrics are shown separately below.`, 'fine activity-note'));
    } else { const empty = node('div', undefined, 'chart-empty'); empty.append(node('span', '↗', 'empty-symbol'), node('strong', 'Your next chapter starts with a package.'), node('p', 'Select npm packages to bring this chart to life.', 'muted'), button('Find npm packages', () => setPage('packages'), 'ghost')); activity.append(empty); }
    const visible = scopedProducts.filter(p => (sourceFilter === 'all' || p.source === sourceFilter) && p.id.toLowerCase().includes(productQuery.toLowerCase()));
    shownCount.textContent = `${visible.length} of ${scopedProducts.length}`;
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
      const health = reading?.health || (reading?.error ? reading.metric ? 'stale' : 'error' : 'empty');
      const labels = { fresh: 'Fresh source data', cached: 'Cached (10-minute limit)', outdated: 'Refresh needed', partial: 'Incomplete npm coverage', stale: 'Source failed - previous reading', error: 'Source unavailable', empty: 'Awaiting source data' };
      card.append(node('p', labels[health] || labels.empty, `source-health health-${health}`));
      if (reading?.attemptedAt) card.append(node('p', `Last source attempt: ${new Date(reading.attemptedAt).toLocaleString()}`, 'fine source-attempt'));
      const metric = reading?.metric;
      if (metric?.kind === 'npm') {
        const windowMetric = metric.windows.find(w => w.days === period); const change = windowMetric?.change;
        card.append(node('div', fmt(windowMetric?.total), 'metric'), node('span', `downloads · ${period} complete UTC days`, 'muted metric-label'));
        card.append(node('p', change == null ? windowMetric?.previous === 0 ? 'No growth rate: preceding period was zero.' : 'Growth unavailable: incomplete comparison data.' : `${change >= 0 ? '↗ +' : '↘ '}${change.toFixed(1)}% vs preceding ${period} days`, change == null ? 'trend muted' : change >= 0 ? 'trend positive' : 'trend negative'));
        const bounds = dateBounds(metric.end, period), markers = markersFor([key], bounds.start, metric.end);
        card.append(sparkline(metric.daily, period, metric.end, false, markers), bounds.bounds);
        if (markers.length) card.append(markerLegend(markers));
        const detail = node('details', undefined, 'daily-details'); detail.append(node('summary', 'Daily values'));
        const tableWrap = node('div', undefined, 'table-wrap'), table = node('table'); table.append(node('caption', 'Source-reported daily npm downloads'));
        const head = node('thead'), headerRow = node('tr'); for (const label of ['UTC date', 'Downloads']) { const th = node('th', label); th.scope = 'col'; headerRow.append(th); } head.append(headerRow); table.append(head);
        const body = node('tbody'); for (const d of metric.daily.filter(d => d.day >= bounds.start)) { const row = node('tr'); row.append(node('td', d.day), node('td', fmt(d.downloads))); body.append(row); } table.append(body); tableWrap.append(table); detail.append(tableWrap); card.append(detail);
      } else if (metric?.kind === 'count') {
        if (metric.title) card.append(node('p', metric.title, 'muted'));
        card.append(node('div', fmt(metric.value), 'metric'), node('p', metric.label, 'muted metric-label'));
        const countNote = node('div', undefined, 'count-note'); countNote.append(node('span', p.source === 'reddit' ? '◌' : '◇', 'count-note-icon'), node('span', 'No historical trend is supplied by this source. Saved local observations start when you track it; gaps remain gaps.', 'fine')); card.append(countNote);
      } else if (!reading?.error) card.append(node('p', state.busy ? 'Loading source data…' : 'No reading yet. Refresh to load.', 'muted loading-reading'));
      const bottom = node('div', undefined, 'card-bottom');
      appendHistory(card, p, reading);
      const freshness = node('small', reading?.fetchedAt ? `${reading.stale ? 'Last success' : 'Fetched'} ${new Date(reading.fetchedAt).toLocaleString()}` : 'No successful reading', 'muted');
      bottom.append(freshness, button('View source ↗', () => send('source', { key }), 'source-link')); card.append(bottom); cards.append(card);
    }
  }
  window.addEventListener('message', event => {
    if(event.data?.type==='launchAvailability'){
      if(event.data.requestId!==availabilityId)return;
      const data=event.data.availability;availabilityBox.replaceChildren();
      if(!data){availabilityBox.append(node('p',event.data.error||'Data availability could not be checked.','error'));return;}
      const comparable=data.rows.filter(r=>r.beforeAvailable&&r.afterAvailable).length,empty=data.rows.every(r=>!r.beforeAvailable&&!r.afterAvailable);
      availabilityBox.append(node('strong',`${data.preliminary?'Early window ready':'Dates complete'} · ${empty?'Historical data missing':comparable===data.rows.length?'Data available':'Data incomplete'}`));
      for(const row of data.rows)availabilityBox.append(node('p',`${row.key} / Before: ${row.before}. After: ${row.after}. First retained observation: ${row.firstRecordedAt||'none'}.`,'fine'));
      availabilityBox.append(node('p','npm daily history comes from its source. Other sources need at least two saved observations in each window; old counts cannot be backfilled by changing a release date.','fine'),button('Collection and storage health',()=>setPage('health'),'ghost'));return;
    }
    if (event.data?.type === 'launchPreview') {
      const message = event.data;
      if (message.requestId !== previewId || !canPreviewCard() || pendingLaunch || typeof message.svg !== 'string' || message.svg.length > 50000) return;
      previewCaption.textContent = cardType.value==='current'?'Current metric preview / 1200 × 630':currentLaunchReport().preliminary ? 'Preliminary share-card preview / 1200 × 630' : 'Share-card preview / 1200 × 630';
      previewImage.onerror = () => { previewCaption.textContent = 'Preview unavailable. You can still export the SVG card.'; previewImage.remove(); };
      try { previewImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(message.svg)}`; cardPreview.append(previewImage); }
      catch { previewCaption.textContent = 'Preview unavailable. You can still export the SVG card.'; }
      return;
    }
    if (event.data?.type === 'renderShareCard') { renderShareCard(event.data); return; }
    if (event.data?.type === 'navigate') {
      if (Object.hasOwn(views, event.data.page)) {
        if (event.data.page === 'overview') { sourceFilter = 'all'; productQuery = ''; productSearch.value = ''; renderAnalytics(); }
        setPage(event.data.page);
      }
      return;
    }
    if (event.data?.type !== 'state') return;
    state = event.data;
    if (!state.busy) pendingLaunch = false;
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
    renderCandidates(); renderInsights(); renderLaunch(); renderHealth(); renderReleaseSuggestions(); renderAnalytics(); setPage(page);
  });
  renderAnalytics(); setPage(page); send('ready');
})();
