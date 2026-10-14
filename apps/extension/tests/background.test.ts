import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { makeRule } from '../src/core/defaults';
import type { LocalState, Request, Rule } from '../src/core/types';

const compiled=await build({entryPoints:['src/background.ts'],bundle:true,write:false,platform:'browser',format:'iife'});
function event(){const listeners:Function[]=[];return {listeners,addListener(fn:Function){listeners.push(fn);}};}
async function boot(rule:Rule,ack=false) {
  const url='https://example.com/a';
  const local:Record<string,any>={behaviorRulesState:{config:{version:1,rules:[rule]},usage:{},grants:[],logs:[]} satisfies LocalState};
  const session:Record<string,any>={behaviorRulesSession:{pages:{1:{url,acks:ack?[rule.id]:[],waits:{},lastEvent:''}},cursor:null}};
  const area=(data:Record<string,any>)=>({get:async(key:string)=>({[key]:structuredClone(data[key])}),set:async(values:object)=>Object.assign(data,structuredClone(values)),setAccessLevel:async()=>{}});
  const tab={id:1,windowId:1,url,active:true};
  const chrome={
    storage:{local:area(local),session:area(session)},
    runtime:{id:'test',getURL:(path:string)=>'chrome-extension://test/'+path,onMessage:event(),onInstalled:event(),onStartup:event(),openOptionsPage:async()=>{}},
    tabs:{query:async()=>[tab],get:async()=>tab,sendMessage:async()=>{},remove:async()=>{},onActivated:event(),onUpdated:event(),onRemoved:event()},
    windows:{getAll:async()=>[{id:1,focused:true,type:'normal'}],onFocusChanged:event()},
    idle:{queryState:async()=>'active',onStateChanged:event()},
    alarms:{get:async()=>({name:'reconcile'}),create:async()=>{},onAlarm:event()},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
    webNavigation:{onHistoryStateUpdated:event(),onReferenceFragmentUpdated:event()},
    scripting:{executeScript:async()=>{}},
  };
  new Function('chrome','crypto',compiled.outputFiles[0].text)(chrome,webcrypto);
  const send=(message:Request)=>new Promise<any>(resolve=>chrome.runtime.onMessage.listeners[0](message,{id:'test',url:'chrome-extension://test/options.html'},resolve));
  await send({type:'GET_STATE',tabId:1});
  const fromContent=(message:unknown)=>new Promise<any>(resolve=>chrome.runtime.onMessage.listeners[0](message,{id:'test',url,tab:{id:1,url},frameId:0},resolve));
  return {chrome,send,fromContent,local,session,url,tab};
}
test('rapid same-task SPA departure invalidates acknowledgement even when live tab query is already back',async()=>{
  const rule={...makeRule('https://example.com'),id:'rapid-spa'};
  const h=await boot(rule,true);
  assert.equal((await h.send({type:'GET_STATE',tabId:1})).data.view.rule,null);
  const navigate=h.chrome.webNavigation.onHistoryStateUpdated.listeners[0];
  navigate({frameId:0,tabId:1,url:'https://example.com/b'});
  navigate({frameId:0,tabId:1,url:h.url});
  const result=await h.send({type:'GET_STATE',tabId:1});
  assert.equal(result.data.view.rule?.id,rule.id);
  assert.deepEqual(h.session.behaviorRulesSession.pages[1].acks,[]);
});
test('rapid tab URL and hash events invalidate previous visit release',async()=>{
  for(const kind of ['tabs','hash']) {
    const h=await boot({...makeRule('https://example.com'),id:'navigation'},true);
    if(kind==='tabs') h.chrome.tabs.onUpdated.listeners[0](1,{url:'https://example.com/b'});
    else h.chrome.webNavigation.onReferenceFragmentUpdated.listeners[0]({frameId:0,tabId:1,url:h.url+'#changed'});
    const result=await h.send({type:'GET_STATE',tabId:1});
    assert.equal(result.data.view.rule?.id,'navigation');
  }
});
test('delay deadlines for inherited-name IDs are serializable and stable across reevaluation',async()=>{
  const h=await boot({...makeRule('https://example.com'),id:'toString',action:'delay',delaySeconds:15});
  const first=(await h.send({type:'GET_STATE',tabId:1})).data.view;
  assert.ok(Number.isFinite(first.waitUntil));
  assert.ok(first.waitUntil>Date.now()+10_000);
  assert.equal((await h.send({type:'GET_STATE',tabId:1})).data.view.waitUntil,first.waitUntil);
});



test('queued acknowledgement from a previous URL cannot release the newly navigated page',async()=>{
  const h=await boot({...makeRule('https://example.com'),id:'ack-race'});
  h.tab.url='https://example.com/b';
  const stale=await h.fromContent({type:'ACK',ruleId:'ack-race',pageUrl:h.url});
  assert.equal(stale.ok,false,'An ACK belongs to the URL that showed its action');
  const current=await h.send({type:'GET_STATE',tabId:1});
  assert.equal(current.data.view.rule?.id,'ack-race');
  const accepted=await h.fromContent({type:'ACK',ruleId:'ack-race',pageUrl:h.tab.url});
  assert.equal(accepted.ok,true);
  assert.equal(accepted.data.view.rule,null);
});
