// Explicit opt-in: makes real public API requests. No credentials or fixtures.
const { Providers } = require('../dist/src/providers');
(async () => {
  const api = new Providers();
  const checks = [
    ['npm scope discovery', async () => { const d=await api.discover('vscode',true); if (!d.packages.length) throw new Error('Known namespace produced no matches'); return `${d.packages.length} public namespace matches · ${d.note}`; }],
    ['npm username discovery', async () => { const d=await api.discover('isaacs',false); if (!d.packages.length) throw new Error('Known maintainer produced no matches'); return `${d.packages.length} public maintainer matches`; }],
    ['npm scoped analytics', async () => { const m=await api.npm('@vscode/vsce'); return JSON.stringify({start:m.start,end:m.end,days:m.daily.length,windows:m.windows}); }],
    ['Open VSX', async () => JSON.stringify(await api.extension({source:'openvsx',id:'redhat.vscode-yaml'}))],
    ['Marketplace', async () => JSON.stringify(await api.extension({source:'marketplace',id:'redhat.vscode-yaml'}))]
  ];
  for (const [label,task] of checks) {
    try { console.log(`${label}: ${await task()}`); }
    catch (e) { console.error(`${label}: ${e.message}`); process.exitCode=1; }
  }
})();
