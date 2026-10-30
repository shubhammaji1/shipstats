import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Analytics, parallelMap } from '../src/service';
import { Providers } from '../src/providers';
import { HttpClient } from '../src/http';
import { dateAt, windows, npmName, extensionId, redditId, restoreProducts, sourceUrl } from '../src/model';

const now = new Date('2026-03-01T02:00:00+05:30'); // UTC is still February 28.
const response = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const daily = (n = 180, value = 10) => Array.from({ length: n }, (_, i) => ({ day: dateAt(now, i - n), downloads: value }));
const provider = (data: unknown) => new Providers(new HttpClient(async () => response(data)));

test('UTC windows cross month, year and leap day without including today', () => {
  assert.equal(dateAt(now, -1), '2026-02-27');
  assert.equal(dateAt(new Date('2024-03-01T10:00Z'), -1), '2024-02-29');
  assert.equal(dateAt(new Date('2026-01-01T00:00Z'), -1), '2025-12-31');
  const result = windows(daily(), now);
  assert.deepEqual(result.map(r => [r.total, r.previous, r.change]), [[70,70,0], [300,300,0], [900,900,0]]);
});
test('growth uses preceding equal-length period; zero denominator stays unavailable', () => {
  const values = daily().map((d, i) => ({ ...d, downloads: i >= 173 ? 20 : 10 }));
  assert.equal(windows(values, now)[0]!.change, 100);
  assert.equal(windows(daily(180, 0), now)[0]!.change, null);
  const missing = windows(daily().slice(0, -1), now)[0]!;
  assert.equal(missing.total, null); assert.equal(missing.previous, 70);
  assert.equal(windows(daily(7), now)[0]!.previous, null);
});
test('identifiers reject paths, query injection and invalid sources; saved state is bounded', () => {
  assert.equal(npmName('@scope/name'), '@scope/name');
  for (const value of ['React', '../name', '@scope/', 'name?bad', 'https://npmjs.com/a', '']) assert.throws(() => npmName(value));
  assert.equal(extensionId('RedHat.vscode-Yaml'), 'redhat.vscode-yaml');
  assert.throws(() => extensionId('publisher/extension'));
  assert.equal(redditId('https://www.reddit.com/r/node/comments/abc123/title/'), 'abc123');
  assert.equal(redditId('https://redd.it/abc123'), 'abc123');
  assert.throws(() => redditId('https://evil.example/comments/abc123'));
  assert.throws(() => redditId('https://www.reddit.com.evil.example/comments/abc123'));
  assert.equal(restoreProducts([{source:'npm',id:'react'}, {source:'npm',id:'react'}, {source:'evil',id:'a'}, {source:'npm',id:'../x'}, null]).length, 1);
  assert.equal(restoreProducts(Array.from({length:70},(_,i)=>({source:'npm',id:`p${i}`}))).length,50);
  assert.equal(sourceUrl({source:'npm',id:'@a/b'}), 'https://www.npmjs.com/package/@a/b');
});
test('npm downloads preserve true zeroes, sort dates, and do not fill missing days', async () => {
  const api = provider({package:'@a/b',downloads:daily().reverse()});
  const metric = await api.npm('@a/b', now); assert.equal(metric.windows[2]!.total,900);
  assert.equal((await provider({package:'react',downloads:daily(180,0)}).npm('react',now)).windows[0]!.total,0);
  assert.equal((await provider({package:'react',downloads:daily().slice(0,-1)}).npm('react',now)).windows[0]!.total,null);
});
test('npm rejects wrong identity, negative counts, duplicate dates, impossible dates and malformed schema', async () => {
  for (const data of [
    {package:'other', downloads:[]}, {package:'react', downloads:[{day:dateAt(now,-1),downloads:-1}]},
    {package:'react', downloads:[daily()[0],daily()[0]]}, {package:'react', downloads:[{day:'2026-02-30',downloads:3}]},
    {package:'react', downloads:'unknown'}, {package:'react', downloads:[{day:dateAt(now,0),downloads:0}]}
  ]) await assert.rejects(provider(data).npm('react',now));
});
test('discovery matches maintainer metadata rather than publisher and deduplicates results', async () => {
  const make = (name: string, username: string) => ({package:{name,description:'A package',maintainers:[{username}],publisher:{username:'owner'}}});
  let queried = '';
  const api = new Providers(new HttpClient(async url => { queried = url; return response({objects:[make('yes','owner'),make('no','other'),make('yes','owner')],total:3}); }));
  const found = await api.discover('owner',false);
  assert.deepEqual(found.packages.map(p=>p.name), ['yes']); assert.match(queried, /maintainer%3Aowner/);
  assert.match(found.note,/not verified ownership/);
});
test('scope discovery verifies exact namespace and paginates with an explicit cap', async () => {
  const urls: string[] = [];
  const api = new Providers(new HttpClient(async url => {
    urls.push(url);
    return response({objects:Array.from({length:250},(_,i)=>({package:{name:i===0?'@scope-other/a':`@scope/p${i}`}})),total:2000});
  }));
  const result = await api.discover('@scope',true);
  assert.equal(urls.length,4); assert.match(urls[3]!, /from=750/); assert.equal(result.packages.length,249);
  assert.match(result.note,/capped/);
});
test('Marketplace request uses exact ID and statistics flag; missing statistics are not zero', async () => {
  const data = {results:[{extensions:[{publisher:{publisherName:'pub'},extensionName:'ext',statistics:[{statisticName:'install',value:123}]}]}]};
  const api = new Providers(new HttpClient(async (url, init) => {
    assert.match(url,/marketplace/); const body = JSON.parse(init!.body as string); assert.equal(body.flags,256); assert.equal(body.filters[0].criteria[0].value,'pub.ext');
    return response(data);
  }));
  assert.equal((await api.extension({source:'marketplace',id:'pub.ext'})).value,123);
  data.results[0]!.extensions[0]!.statistics = [];
  await assert.rejects(api.extension({source:'marketplace',id:'pub.ext'}),/valid count/);
});
test('Open VSX validates identity and cumulative downloadCount', async () => {
  const metric = await provider({namespace:'pub',name:'ext',downloadCount:0}).extension({source:'openvsx',id:'pub.ext'});
  assert.equal(metric.value,0); assert.match(metric.label,/cumulative/);
  await assert.rejects(provider({namespace:'pub',name:'ext'}).extension({source:'openvsx',id:'pub.ext'}));
  await assert.rejects(provider({namespace:'other',name:'ext',downloadCount:1}).extension({source:'openvsx',id:'pub.ext'}));
});
test('Reddit never uses anonymous access and sends token only to OAuth host', async () => {
  let calls = 0;
  const api = new Providers(new HttpClient(async (url, init) => {
    calls++; assert.equal(new URL(url).hostname,'oauth.reddit.com');
    assert.equal((init!.headers as Record<string,string>).Authorization,'Bearer secret');
    return response({data:{children:[{data:{id:'abc123',num_comments:42,title:'Post'}}]}});
  }));
  await assert.rejects(api.reddit('abc123',undefined,'app'),/approved/); await assert.rejects(api.reddit('abc123','secret',''),/User-Agent/);
  assert.equal(calls,0); assert.equal((await api.reddit('abc123','secret','app/1 by u/user')).value,42);
});
test('HTTP surfaces offline, invalid JSON, auth, not found, timeout and Retry-After without leaking response bodies', async () => {
  for (const status of [401,403,404,500]) await assert.rejects(new HttpClient(async()=>new Response('sensitive body',{status})).json('https://example.com'), new RegExp(String(status)));
  await assert.rejects(new HttpClient(async()=>new Response('not json')).json('https://example.com'),/invalid JSON/);
  await assert.rejects(new HttpClient(async()=>{ throw new TypeError('fetch failed'); }).json('https://example.com'),/connection/);
  await assert.rejects(new HttpClient(async()=>{ throw new DOMException('timeout','TimeoutError'); }).json('https://example.com'),/timed out/);
  let calls = 0; const client = new HttpClient(async()=>{ calls++; return new Response('',{status:429,headers:{'retry-after':'120'}}); });
  await assert.rejects(client.json('https://example.com/a'),/429/); await assert.rejects(client.json('https://example.com/b'),/rate limited/); assert.equal(calls,1);
});
test('cached successes expire; failures retain explicitly stale data and retry; removal prunes cache', async () => {
  let calls = 0, fail = false, tick = now.getTime();
  const api = new Providers(new HttpClient(async()=>{ calls++; if (fail) throw new Error('offline'); return response({package:'react',downloads:daily()}); }));
  const service = new Analytics(api,()=>new Date(tick)); const p = {source:'npm' as const,id:'react'};
  await service.read(p); await service.read(p); assert.equal(calls,1);
  tick += 600001; fail = true; const stale = await service.read(p); assert.equal(stale.stale,true); assert.equal(stale.error,'offline'); assert.ok(stale.metric);
  await service.read(p); assert.equal(calls,3);
  fail = false; service.prune([]); await service.read(p); assert.equal(calls,4);
});
test('concurrency is bounded and output order follows selection', async () => {
  let active = 0, max = 0;
  const result = await parallelMap([1,2,3,4,5,6], async n => { active++; max = Math.max(max,active); await new Promise(resolve=>setTimeout(resolve,5)); active--; return n*2; },2);
  assert.deepEqual(result,[2,4,6,8,10,12]); assert.equal(max,2);
});
