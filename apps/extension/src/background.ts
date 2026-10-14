import type { LocalState, Snapshot, PageView, Request, Response, Rule } from './core/types';
import { decide, accrueUsage, validateRule, validateConfig } from './core/engine';
import { elapsedInterval, updatePageSession, pruneUsage, waitDeadline, type Cursor, type PageSession } from './runtime';

const LOCAL_KEY = 'behaviorRulesState';
const SESSION_KEY = 'behaviorRulesSession';
let state: LocalState;
let session: { pages: Record<number,PageSession>; cursor: Cursor | null };
let locked = false;
let queue: Promise<unknown> = Promise.resolve();
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  const local = (await chrome.storage.local.get(LOCAL_KEY))[LOCAL_KEY];
  state = local || {config:{version:1,rules:[]},usage:{},grants:[],logs:[]};
  // An invalid configuration must be reported, never silently replaced.
  state.config = validateConfig(state.config);
  session = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || {pages:{},cursor:null};
  locked = (await chrome.idle.queryState(60)) === 'locked';
  if (!await chrome.alarms.get('reconcile')) await chrome.alarms.create('reconcile',{periodInMinutes:0.5});
})();

function serial<T>(fn:()=>Promise<T>):Promise<T> {
  const result = queue.then(async()=>{await ready; return fn();});
  queue = result.catch(error=>console.error('行为规则：',error));
  return result;
}
function supported(url:string) {
  try { const u=new URL(url); return ['http:','https:'].includes(u.protocol) && !['chromewebstore.google.com','chrome.google.com','microsoftedge.microsoft.com'].includes(u.hostname); } catch { return false; }
}
function settle(now:number) {
  const interval=elapsedInterval(session.cursor,now);
  if (interval && session.cursor) state.usage=accrueUsage(state.usage,state.config.rules,session.cursor.url,...interval);
  session.cursor=null;
  state.grants=state.grants.filter(g=>g.expiresAt>now);
  state.usage=pruneUsage(state.usage);
}
async function persist() {
  await chrome.storage.local.set({[LOCAL_KEY]:state});
  await chrome.storage.session.set({[SESSION_KEY]:session});
}
function pageSession(tabId:number,url:string):PageSession {
  return session.pages[tabId]=updatePageSession(session.pages[tabId],url);
}
function makeView(tabId:number,url:string,now:number):PageView {
  const p=pageSession(tabId,url);
  if (!supported(url)) return {url,supported:false,rule:null,reason:'此页面不支持网页规则。请在普通 HTTP / HTTPS 网页上使用。',usedMs:0,matchedNames:[]};
  const d=decide(url,state.config.rules,state.usage,state.grants,now,p.acks);
  const r=d.rule;
  const granted=state.grants.some(g=>d.matched.some(m=>m.id===g.ruleId)) || p.acks.length>0;
  const result:PageView={url,supported:true,rule:r,reason:d.reason,usedMs:d.usedMs,matchedNames:d.matched.map(m=>m.name),granted};
  if (r?.action==='delay') {
    waitDeadline(p,r.id,now,r.delaySeconds);
    result.waitUntil=p.waits[r.id];
  }
  // Once a rule ceases to apply its previous countdown is no longer reusable.
  for (const id of Object.keys(p.waits)) if (id!==r?.id) delete p.waits[id];
  const fingerprint=r ? `${r.id}|${r.action}` : '';
  if (fingerprint && p.lastEvent!==fingerprint) {
    state.logs.unshift({id:crypto.randomUUID(),at:now,ruleId:r!.id,ruleName:r!.name,action:r!.action,url:logUrl(url),detail:d.reason});
    state.logs=state.logs.slice(0,300);
  }
  p.lastEvent=fingerprint;
  return result;
}
function logUrl(url:string) { try {const u=new URL(url);return (u.origin+u.pathname).slice(0,2048);}catch{return '';}}
async function foreground():Promise<chrome.tabs.Tab|undefined> {
  if(locked) return;
  const windows=await chrome.windows.getAll({windowTypes:['normal']});
  const focused=windows.find(w=>w.focused);
  if(focused?.id===undefined) return;
  return (await chrome.tabs.query({active:true,windowId:focused.id}))[0];
}
async function push(tab:chrome.tabs.Tab,view:PageView) {
  if(tab.id===undefined) return;
  await chrome.action.setBadgeText({tabId:tab.id,text:view.rule ? ({block:'停',delay:'等',remind:'醒'}[view.rule.action]) : ''}).catch(()=>{});
  await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:'#147d72'}).catch(()=>{});
  await chrome.action.setTitle({tabId:tab.id,title:view.rule ? `正在生效：${view.rule.name}` : '停一下 · 网页行为规则'}).catch(()=>{});
  await chrome.tabs.sendMessage(tab.id,{type:'APPLY_VIEW',view}).catch(()=>{});
}
async function reconcile(now:number,all=false) {
  const active=await foreground();
  const tabs=all ? await chrome.tabs.query({}) : active ? [active] : [];
  for (const tab of tabs) {
    if(tab.id===undefined) continue;
    const view=makeView(tab.id,tab.url||'',now);
    await push(tab,view);
    if(tab.id===active?.id && supported(tab.url||'')) session.cursor={tabId:tab.id,url:tab.url!,at:now,blocked:!!view.rule && view.rule.action!=='remind'};
  }
}
async function snapshot(tabId?:number):Promise<Snapshot> {
  const now=Date.now();
  let view:PageView|undefined;
  if(tabId!==undefined) {
    const tab=await chrome.tabs.get(tabId).catch(()=>null);
    if(tab) view=makeView(tabId,tab.url||'',now);
  }
  return {...state,view,tabId,now};
}
function trustedPage(sender:chrome.runtime.MessageSender) {
  return sender.id===chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
}
async function handle(msg:Request,sender:chrome.runtime.MessageSender):Promise<Snapshot> {
  if(!msg || typeof msg.type!=='string') throw new Error('无效请求');
  const contentAllowed=['TICK','ACK','OPEN_OPTIONS','CLOSE_TAB'];
  const trusted=trustedPage(sender);
  if(!trusted && !(sender.id===chrome.runtime.id && sender.tab?.id!==undefined && sender.frameId===0 && contentAllowed.includes(msg.type))) throw new Error('没有权限执行此操作');
  const now=Date.now();
  settle(now);
  let all=false;
  let tabId = trusted && msg.type==='GET_STATE' ? msg.tabId : sender.tab?.id;
  switch(msg.type) {
    case 'SAVE_RULE': {
      const rule=validateRule(msg.rule);
      const rules=state.config.rules.filter(r=>r.id!==rule.id);
      state.config=validateConfig({version:1,rules:[...rules,rule]});
      for(const p of Object.values(session.pages)) {p.acks=p.acks.filter(id=>id!==rule.id);delete p.waits[rule.id];p.lastEvent='';}
      state.grants=state.grants.filter(g=>g.ruleId!==rule.id);
      all=true;break;
    }
    case 'DELETE_RULE':
      state.config.rules=state.config.rules.filter(r=>r.id!==msg.id);
      state.grants=state.grants.filter(g=>g.ruleId!==msg.id);
      for(const day of Object.values(state.usage)) delete day[msg.id];
      all=true;break;
    case 'TOGGLE_RULE': {
      if(typeof msg.enabled!=='boolean') throw new Error('启停状态无效');
      const rule=state.config.rules.find(r=>r.id===msg.id);if(!rule) throw new Error('规则不存在');
      rule.enabled=msg.enabled;
      for(const p of Object.values(session.pages)) {p.acks=p.acks.filter(id=>id!==msg.id);delete p.waits[msg.id];p.lastEvent='';}
      all=true;break;
    }
    case 'IMPORT_CONFIG': {
      const config=validateConfig(msg.config);
      state.config=config;state.grants=[];state.usage={};session.pages={};all=true;break;
    }
    case 'CLEAR_LOGS': state.logs=[];break;
    case 'BYPASS': {
      const rule=state.config.rules.find(r=>r.id===msg.id);if(!rule) throw new Error('规则不存在');
      const minutes=msg.minutes ?? 15;
      if(!Number.isFinite(minutes)||minutes<1||minutes>1440) throw new Error('放行时长需为 1 至 1440 分钟');
      state.grants=state.grants.filter(g=>g.ruleId!==msg.id);
      state.grants.push({ruleId:msg.id,expiresAt:now+minutes*60_000});
      state.logs.unshift({id:crypto.randomUUID(),at:now,ruleId:rule.id,ruleName:rule.name,action:'bypass',url:'',detail:`临时放行 ${minutes} 分钟`});state.logs=state.logs.slice(0,300);all=true;break;
    }
    case 'REVOKE_BYPASS': state.grants=state.grants.filter(g=>g.ruleId!==msg.id);all=true;break;
    case 'ACK': {
      if(sender.tab?.id===undefined) throw new Error('请从网页确认');
      const tab=await chrome.tabs.get(sender.tab.id);
      if (typeof msg.pageUrl!=='string' || msg.pageUrl!==tab.url) throw new Error('网页地址已变化，请在当前页面重新确认');
      const view=makeView(tab.id!,tab.url||'',now);
      if(!view.rule || view.rule.id!==msg.ruleId || view.rule.action==='block') throw new Error('当前规则不允许此操作');
      if(view.rule.action==='delay' && (view.waitUntil||Infinity)>now) throw new Error('倒计时尚未结束');
      pageSession(tab.id!,tab.url!).acks.push(view.rule.id);break;
    }
    case 'OPEN_OPTIONS': await chrome.runtime.openOptionsPage();break;
    case 'CLOSE_TAB': if(sender.tab?.id!==undefined) await chrome.tabs.remove(sender.tab.id);tabId=undefined;break;
    case 'GET_STATE':case 'TICK':break;
    default: throw new Error('未知操作');
  }
  await reconcile(now,all);
  const data=await snapshot(tabId);
  await persist();
  return data;
}
chrome.runtime.onMessage.addListener((msg:Request,sender,respond:(response:Response)=>void)=>{
  serial(()=>handle(msg,sender)).then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,error:e instanceof Error?e.message:'操作失败，请重试'}));
  return true;
});
function event(all=false) { void serial(async()=>{const now=Date.now();settle(now);await reconcile(now,all);await persist();}).catch(()=>{}); }
chrome.tabs.onActivated.addListener(()=>event());
chrome.windows.onFocusChanged.addListener(()=>event());
chrome.idle.onStateChanged.addListener(value=>{void serial(async()=>{const now=Date.now();settle(now);locked=value==='locked';await reconcile(now,true);await persist();});});
function navigation(tabId:number,url:string) { void serial(async()=>{const now=Date.now();settle(now);pageSession(tabId,url);await reconcile(now,true);await persist();}).catch(()=>{}); }
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url) navigation(id,change.url);else if(change.status==='complete') event(true);});
chrome.webNavigation.onHistoryStateUpdated.addListener(details=>{if(details.frameId===0) navigation(details.tabId,details.url);});
chrome.webNavigation.onReferenceFragmentUpdated.addListener(details=>{if(details.frameId===0) navigation(details.tabId,details.url);});
chrome.tabs.onRemoved.addListener(id=>{void serial(async()=>{settle(Date.now());delete session.pages[id];await reconcile(Date.now());await persist();});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='reconcile') event(true);});
async function injectExisting() {
  for(const tab of await chrome.tabs.query({})) {
    if(tab.id!==undefined && supported(tab.url||'')) await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}).catch(()=>{});
  }
}
chrome.runtime.onInstalled.addListener(()=>{void serial(async()=>{await injectExisting();await reconcile(Date.now(),true);await persist();});});
chrome.runtime.onStartup.addListener(()=>{void serial(async()=>{session={pages:{},cursor:null};await injectExisting();await reconcile(Date.now(),true);await persist();});});
