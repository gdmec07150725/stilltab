import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesUrl, matchesRule, isScheduleActive, localDateKey, decide, accrueUsage, validateConfig, validateRule } from '../src/core/engine';
import { makeRule, templates } from '../src/core/defaults';
import type { Rule, Matcher, Schedule } from '../src/core/types';
const matcher = (kind: Matcher['kind'], value: string, options: Partial<Matcher> = {}): Matcher => ({ kind, value, includeSubdomains: false, ignoreQuery: false, ignoreHash: true, ...options });
const rule = (overrides: Partial<Rule> = {}): Rule => ({ id: 'r1', name: '测试规则', enabled: true, match: matcher('site', 'https://example.com'), exceptions: [], schedule: { enabled: false, days: [1,2,3,4,5], start: '09:00', end: '18:00' }, quotaMinutes: 0, action: 'remind', delaySeconds: 15, message: '停下来想一想', buttonText: '继续浏览', priority: 0, createdAt: 1, ...overrides });
const date = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second);

test('website matches normalized hostname without matching sibling or lookalike domains', () => {
  const m = matcher('site', 'https://EXAMPLE.com:443/ignored');
  assert.equal(matchesUrl('http://example.com:8080/a?q=1', m), true);
  assert.equal(matchesUrl('https://www.example.com/', m), false);
  assert.equal(matchesUrl('https://evil-example.com/', m), false);
  assert.equal(matchesUrl('https://example.com.evil.org/', m), false);
  assert.equal(matchesUrl('https://www.example.com/', { ...m, includeSubdomains: true }), true);
  assert.equal(matchesUrl('https://example.com./', m), true);
});
test('path match respects segment boundaries and ignores URL query/hash', () => {
  const m = matcher('path', 'https://example.com/news/');
  assert.equal(matchesUrl('http://example.com:8080/news', m), true);
  assert.equal(matchesUrl('https://example.com/news/article?q=1#top', m), true);
  assert.equal(matchesUrl('https://example.com/newsletter', m), false);
  assert.equal(matchesUrl('https://example.com/News', m), false);
});
test('exact page preserves protocol, port, trailing slash, query, with opt-in query/hash behavior', () => {
  const m = matcher('page', 'https://example.com/a?item=1');
  assert.equal(matchesUrl('https://EXAMPLE.com:443/a?item=1#top', m), true);
  assert.equal(matchesUrl('https://example.com/a?item=2', m), false);
  assert.equal(matchesUrl('http://example.com/a?item=1', m), false);
  assert.equal(matchesUrl('https://example.com:8443/a?item=1', m), false);
  assert.equal(matchesUrl('https://example.com/a/?item=1', m), false);
  assert.equal(matchesUrl('https://example.com/a?item=2', { ...m, ignoreQuery: true }), true);
  assert.equal(matchesUrl('https://example.com/a?item=1#top', { ...m, ignoreHash: false }), false);
});
test('URL normalization handles dot segments, Unicode hosts, and unreserved percent encoding', () => {
  assert.equal(matchesUrl('https://example.com/a/../~name', matcher('page', 'https://example.com/%7ename')), true);
  assert.equal(matchesUrl('https://xn--fsqu00a.xn--0zwm56d/', matcher('site', 'https://例子.测试')), true);
});
test('unsupported or malformed URLs never match', () => {
  for (const url of ['chrome://settings', 'file:///tmp/a', 'javascript:alert(1)', 'not a url', '']) assert.equal(matchesUrl(url, matcher('site', 'example.com')), false);
  assert.equal(matchesUrl('https://example.com/', matcher('site', 'https://')), false);
});
test('exception excludes only its owning rule, and disabled rules do not match', () => {
  const r = rule({ exceptions: [matcher('path', 'https://example.com/work')] });
  assert.equal(matchesRule('https://example.com/work/a', r), false);
  assert.equal(matchesRule('https://example.com/news', r), true);
  assert.equal(matchesRule('https://example.com/news', { ...r, enabled: false }), false);
  assert.equal(decide('https://example.com/work/a', [r, rule({ id: 'other', action: 'block' })], {}, [], +date(12,10)).rule?.id, 'other');
});
test('weekday schedules include start and exclude end exactly', () => {
  const s: Schedule = { enabled: true, days: [1], start: '09:00', end: '18:00' };
  assert.equal(isScheduleActive(s, date(12,8,59)), false);
  assert.equal(isScheduleActive(s, date(12,9)), true);
  assert.equal(isScheduleActive(s, date(12,17,59,59)), true);
  assert.equal(isScheduleActive(s, date(12,18)), false);
  assert.equal(isScheduleActive(s, date(13,10)), false);
  assert.equal(isScheduleActive({ ...s, enabled: false }, date(13,10)), true);
});
test('cross-midnight schedule belongs to the selected starting day', () => {
  const s: Schedule = { enabled: true, days: [1], start: '22:00', end: '02:00' };
  assert.equal(isScheduleActive(s, date(12,1)), false);
  assert.equal(isScheduleActive(s, date(12,22)), true);
  assert.equal(isScheduleActive(s, date(13,1,59,59)), true);
  assert.equal(isScheduleActive(s, date(13,2)), false);
  assert.equal(isScheduleActive(s, date(13,22)), false);
});
test('equal start/end means selected calendar day, not a rolling 24-hour window', () => {
  const s: Schedule = { enabled: true, days: [1], start: '09:00', end: '09:00' };
  assert.equal(isScheduleActive(s, date(12,0)), true);
  assert.equal(isScheduleActive(s, date(12,23,59)), true);
  assert.equal(isScheduleActive(s, date(13,8)), false);
});
test('conflicts use action severity, then priority, creation time, and id', () => {
  const rules = [rule({ id: 'remind', priority: 999 }), rule({ id: 'delay', action: 'delay' }), rule({ id: 'block', action: 'block', priority: -1 })];
  assert.equal(decide('https://example.com', rules, {}, [], +date(12,10)).rule?.id, 'block');
  const same = [rule({ id: 'z', priority: 1, createdAt: 2 }), rule({ id: 'b', priority: 2, createdAt: 2 }), rule({ id: 'a', priority: 2, createdAt: 2 }), rule({ id: 'older', priority: 2, createdAt: 1 })];
  assert.equal(decide('https://example.com', same, {}, [], +date(12,10)).rule?.id, 'older');
  assert.equal(decide('https://example.com', same.slice(0,3), {}, [], +date(12,10)).rule?.id, 'a');
});
test('quota triggers at threshold, resets by local date, and combines with schedule', () => {
  const r = rule({ quotaMinutes: 1, schedule: { enabled: true, days: [1], start: '09:00', end: '18:00' } });
  assert.equal(decide('https://example.com', [r], {'2026-10-12': {r1:59999}}, [], +date(12,10)).rule, null);
  const result = decide('https://example.com', [r], {'2026-10-12': {r1:60000}}, [], +date(12,10));
  assert.equal(result.rule?.id, 'r1'); assert.equal(result.usedMs, 60000);
  assert.equal(decide('https://example.com', [r], {'2026-10-12': {r1:60000}}, [], +date(12,18)).rule, null);
  assert.equal(decide('https://example.com', [rule({quotaMinutes:1})], {'2026-10-12': {r1:60000}}, [], +date(13,10)).rule, null);
});
test('temporary release and per-page acknowledgement skip only their named rules', () => {
  const now = +date(12,10);
  const rules = [rule({ id:'block', action:'block' }),rule({ id:'delay',action:'delay' }),rule({ id:'remind' })];
  const grant = [{ ruleId:'block',expiresAt:now+1 }];
  assert.equal(decide('https://example.com',rules,{},grant,now).rule?.id,'delay');
  assert.equal(decide('https://example.com',rules,{},grant,now,['delay']).rule?.id,'remind');
  assert.equal(decide('https://example.com',rules,{},grant,now+1).rule?.id,'block');
});
test('matched reports in-schedule rules even while quota or grants suppress execution', () => {
  const r = rule({quotaMinutes:10});
  assert.equal(decide('https://example.com',[r],{},[],+date(12,10)).matched.length,1);
  assert.equal(decide('https://other.com',[r],{},[],+date(12,10)).matched.length,0);
});
test('usage accrues every applicable rule once and does not mutate stored state', () => {
  const usage = {'2026-10-12':{r1:1000}};
  const rules = [rule(),rule({id:'quota',quotaMinutes:10}),rule({id:'off',enabled:false}),rule({id:'excluded',exceptions:[matcher('site','https://example.com')]})];
  assert.deepEqual(accrueUsage(usage,rules,'https://example.com',+date(12,10),+date(12,10,0,3)),{'2026-10-12':{r1:4000,quota:3000}});
  assert.deepEqual(usage,{'2026-10-12':{r1:1000}});
});
test('usage splits precisely at midnight into separate local daily buckets', () => {
  assert.deepEqual(accrueUsage({},[rule()],'https://example.com',+date(12,23,59,59),+date(13,0,0,2)),{'2026-10-12':{r1:1000},'2026-10-13':{r1:2000}});
  assert.equal(localDateKey(date(12,0)), '2026-10-12');
});
test('usage counts only scheduled portions when one sample crosses start and end', () => {
  const r = rule({schedule:{enabled:true,days:[1],start:'09:00',end:'10:00'}});
  assert.deepEqual(accrueUsage({},[r],'https://example.com',+date(12,8),+date(12,11)),{'2026-10-12':{r1:3600000}});
});
test('cross-midnight schedule usage splits day and stops at next-day end', () => {
  const r = rule({schedule:{enabled:true,days:[1],start:'22:00',end:'02:00'}});
  assert.deepEqual(accrueUsage({},[r],'https://example.com',+date(12,21),+date(13,3)),{'2026-10-12':{r1:7200000},'2026-10-13':{r1:7200000}});
});
test('nonpositive or invalid intervals and unsupported pages cannot add usage', () => {
  const usage = {'2026-10-12':{r1:1000}};
  assert.deepEqual(accrueUsage(usage,[rule()],'https://example.com',10,10),usage);
  assert.deepEqual(accrueUsage(usage,[rule()],'https://example.com',20,10),usage);
  assert.deepEqual(accrueUsage(usage,[rule()],'https://example.com',NaN,10),usage);
  assert.deepEqual(accrueUsage(usage,[rule()],'chrome://settings',+date(12,9),+date(12,10)),usage);
});
test('config accepts clean round-trip data, strips unknown fields, and creates isolated objects', () => {
  const input = { version:1, rules:[{...rule(), unexpected:'discard'}], unknown:true };
  const result = validateConfig(input);
  assert.deepEqual(result,{version:1,rules:[{...rule(),match:{...rule().match,value:'https://example.com/'}}]});
  assert.notEqual(result.rules[0],input.rules[0]);
});
test('imports reject invalid versions, malformed rules, duplicate ids, and resource excesses', () => {
  for (const input of [null,[],{}, {version:2,rules:[]}, {version:1,rules:'no'}, {version:1,rules:[rule(),rule()]}, {version:1,rules:Array.from({length:201},(_,i)=>rule({id:`r${i}`}))}]) assert.throws(()=>validateConfig(input));
  for (const bad of [{quotaMinutes:-1},{quotaMinutes:1.5},{delaySeconds:0},{action:'eval'},{message:'a'.repeat(1001)},{name:''},{enabled:'true'},{priority:Infinity},{createdAt:-1},{exceptions:Array(21).fill(matcher('site','https://example.com'))},{schedule:{enabled:true,days:[],start:'09:00',end:'18:00'}},{schedule:{enabled:true,days:[8],start:'09:00',end:'18:00'}},{schedule:{enabled:true,days:[1],start:'25:00',end:'18:00'}},{match:matcher('site','javascript:alert(1)')}]) assert.throws(()=>validateRule({...rule(),...bad}));
});
test('imports reject prototype-sensitive ids and credential-bearing match URLs', () => {
  for (const id of ['__proto__','constructor','prototype']) assert.throws(()=>validateRule(rule({id})));
  assert.throws(()=>validateRule(rule({match:matcher('site','https://user:pass@example.com')})));
  const parsed = JSON.parse('{"version":1,"rules":[],"__proto__":{"polluted":true}}');
  assert.deepEqual(validateConfig(parsed),{version:1,rules:[]});
  assert.equal(({} as any).polluted,undefined);
});
test('new rules and all templates produce valid editable rules without shared nested state', () => {
  const a = makeRule('https://example.com/path?a=1'); const b = makeRule('https://example.com/path');
  validateRule(a); assert.notEqual(a.id,b.id); assert.equal(a.match.kind,'site'); assert.equal(a.enabled,true);
  a.schedule.days.push(0); assert.equal(b.schedule.days.includes(0),false);
  assert.ok(templates.length >= 3);
  for (const template of templates) validateRule(template.create('https://example.com'));
});
test('bare host with port is accepted, while malformed schemes remain rejected', () => {
  const r = validateRule(rule({match:matcher('site','localhost:8080')}));
  assert.equal(r.match.value,'https://localhost:8080/');
  assert.equal(matchesUrl('http://localhost:9000/a',r.match),true);
  assert.throws(()=>validateRule(rule({match:matcher('site','mailto:abc@example.com')})));
});
test('corrupted daily usage buckets are treated as unused instead of crashing evaluation', () => {
  const result = decide('https://example.com',[rule({quotaMinutes:1})],{'2026-10-12':null} as any,[],+date(12,10));
  assert.equal(result.rule,null); assert.equal(result.usedMs,0);
});
test('very long valid hostnames create valid rules with a bounded display name', () => {
  const host = `${'a'.repeat(60)}.${'b'.repeat(60)}.example.com`;
  assert.doesNotThrow(()=>validateRule(makeRule(`https://${host}/`)));
});
test('normalized Unicode match URLs cannot pass once and fail when persisted configuration is reloaded', () => {
  const oversized = {version:1,rules:[rule({match:matcher('page','https://example.com/'+'中'.repeat(300))})]};
  assert.throws(()=>validateConfig(oversized),/2048/);
  const allowed = validateConfig({version:1,rules:[rule({match:matcher('page','https://例子.测试/'+'中'.repeat(200)),exceptions:[matcher('page','https://example.com/例外')]})]});
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(allowed))),allowed);
  assert.throws(()=>validateRule(rule({exceptions:[matcher('page','https://example.com/'+'中'.repeat(300))]})),/2048/);
});
test('configuration capacity is checked in UTF-8 bytes of formatted export including trailing newline', () => {
  const large = {version:1,rules:Array.from({length:200},(_,i)=>rule({id:`r${i}`,message:'中'.repeat(1000),exceptions:Array.from({length:5},()=>matcher('page','https://example.com/'+'a'.repeat(1381))) }))};
  const serialized = JSON.stringify(large,null,2)+'\n';
  assert.ok(serialized.length < 2*1024*1024,'fixture must fit a character-count check');
  assert.ok(new TextEncoder().encode(serialized).byteLength > 2*1024*1024,'fixture must exceed UTF-8 byte capacity');
  assert.throws(()=>validateConfig(large),/2 MiB/);
  const smaller = {version:1,rules:large.rules.slice(0,100)};
  const accepted = validateConfig(smaller);
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(accepted,null,2)+'\n')),accepted);
});
test('the exact 2 MiB export boundary includes indentation and its final newline', () => {
  const input = {version:1 as const,rules:Array.from({length:50},(_,i)=>validateRule(rule({id:`boundary${i}`,exceptions:Array.from({length:20},()=>matcher('page','https://example.com/'))})))};
  let remaining = 2*1024*1024 - Buffer.byteLength(JSON.stringify(input,null,2)+'\n','utf8');
  for (const r of input.rules) for (const m of r.exceptions) {
    const fill = Math.min(remaining,2048-m.value.length);
    m.value += 'a'.repeat(fill); remaining -= fill;
  }
  assert.equal(remaining,0,'fixture must fill exactly to the documented byte boundary');
  assert.equal(Buffer.byteLength(JSON.stringify(input,null,2)+'\n','utf8'),2*1024*1024);
  assert.doesNotThrow(()=>validateConfig(input));
  input.rules[0].message += 'a';
  assert.equal(Buffer.byteLength(JSON.stringify(input,null,2),'utf8'),2*1024*1024);
  assert.throws(()=>validateConfig(input),/2 MiB/);
});
