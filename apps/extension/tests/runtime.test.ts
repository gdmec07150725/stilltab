import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedInterval, updatePageSession, pruneUsage } from '../src/runtime';
test('only a fresh foreground lease contributes time', () => {
  assert.deepEqual(elapsedInterval({tabId:1,url:'https://example.com/',at:1000,blocked:false},4000),[1000,4000]);
  assert.equal(elapsedInterval({tabId:1,url:'https://example.com/',at:1000,blocked:false},9000),null);
  assert.equal(elapsedInterval({tabId:1,url:'https://example.com/',at:1000,blocked:true},2000),null);
  assert.equal(elapsedInterval(null,2000),null);
  assert.equal(elapsedInterval({tabId:1,url:'https://example.com/',at:3000,blocked:false},2000),null);
});
test('refresh retains a release but a URL change removes it and wait state', () => {
  const session={url:'https://example.com/a',acks:['r'],waits:{r:4000},lastEvent:'r'};
  assert.deepEqual(updatePageSession(session,session.url),session);
  assert.deepEqual(updatePageSession(session,'https://example.com/b'),{url:'https://example.com/b',acks:[],waits:{},lastEvent:''});
});
test('only recent usage days are retained with no mutation',()=>{
  const u={'2026-01-01':{r:1},'2026-01-02':{r:2},'2026-01-03':{r:3}};
  assert.deepEqual(pruneUsage(u,2),{'2026-01-02':{r:2},'2026-01-03':{r:3}});
  assert.equal(Object.keys(u).length,3);
});

test('inherited object property names cannot skip a delay, including after storage roundtrip', async()=>{
  const {waitDeadline}=await import('../src/runtime');
  for(const id of ['toString','valueOf','hasOwnProperty','__defineGetter__']) {
    const page=updatePageSession(undefined,'https://example.com');
    assert.equal(waitDeadline(page,id,1000,3),4000);
    const restored=JSON.parse(JSON.stringify(page));
    assert.equal(waitDeadline(restored,id,2000,3),4000);
  }
});
