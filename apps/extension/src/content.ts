import type { PageView, Response, Snapshot, Request } from './core/types';

const scope=window as Window & {__behaviorRulesCleanup?:()=>void};
scope.__behaviorRulesCleanup?.();
let host:HTMLDivElement|undefined;
let dialog:HTMLDialogElement|undefined;
let count:HTMLElement|undefined;
let primary:HTMLButtonElement|undefined;
let current:PageView|undefined;
let signature='';
let stopped=false;
let inflight=false;
let lastUrl=location.href;
let focusBefore:Element|null=null;

const css=`
:host{all:initial!important;color-scheme:light!important;font-family:"Segoe UI","Microsoft YaHei",sans-serif!important}
*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0;border-radius:9px;min-height:44px;padding:10px 19px;font-weight:600}button:focus-visible{outline:3px solid #64c7bd;outline-offset:3px}button:disabled{cursor:wait;opacity:.65}
.br-dialog{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:28px;border:0;background:#f2f6f5;color:#18332e;overflow:auto}
.br-dialog[open]{display:grid;place-items:center}.br-dialog::backdrop{background:#f2f6f5}
.br-card{width:min(100%,540px);padding:42px;background:white;border:1px solid #d9e4e0;border-radius:22px;box-shadow:0 18px 70px #18332e0c}
.br-mark{width:42px;height:42px;background:#e3f3ec;border-radius:13px;color:#126f62;display:grid;place-items:center;font-size:24px;margin-bottom:26px}
.br-label{font-size:13px;color:#49665f;line-height:1.5;margin:0 0 12px}.br-card h1{font-size:29px;line-height:1.35;letter-spacing:-.5px;margin:0 0 18px;font-weight:650}.br-message{font-size:17px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 24px}
.br-rule{white-space:pre-line;font-size:13px;line-height:1.8;color:#49665f;background:#f4f7f5;padding:14px 16px;border-radius:10px;margin-bottom:24px;overflow-wrap:anywhere}
.br-time{font-variant-numeric:tabular-nums;font-size:48px;letter-spacing:-2px;margin:10px 0 24px;font-weight:600;color:#147d72}
.br-actions{display:flex;flex-wrap:wrap;gap:10px}.br-primary{background:#147d72;color:#fff}.br-secondary{background:#edf3f0;color:#294b42}.br-foot{font-size:12px;color:#5f736d;line-height:1.7;margin:22px 0 0}.br-error{font-size:13px;color:#a12d29;margin-top:12px}
.br-toast{position:fixed;bottom:24px;right:24px;z-index:2147483647;width:min(410px,calc(100vw - 32px));background:white;padding:25px;border:1px solid #c9dad2;border-radius:16px;box-shadow:0 10px 45px #153b2c28;color:#18332e}.br-toast h1{font-size:20px;margin:0 0 12px}.br-toast .br-message{font-size:15px;margin-bottom:17px}.br-toast .br-rule{margin-bottom:18px}.br-toast .br-label{margin-bottom:12px}
@media(max-width:600px){.br-card{padding:26px}.br-dialog{padding:16px}.br-toast{bottom:16px;right:16px}.br-card h1{font-size:25px}}
`;
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string) {
  const el=document.createElement(tag);if(text!==undefined) el.textContent=text;if(className) el.className=className;return el;
}
function clear() {
  dialog?.close();host?.remove();host=undefined;dialog=undefined;count=undefined;primary=undefined;signature='';
  if(focusBefore instanceof HTMLElement && focusBefore.isConnected) focusBefore.focus({preventScroll:true});
  focusBefore=null;
}
async function request(msg:Request):Promise<Snapshot|undefined> {
  try {
    const result=await chrome.runtime.sendMessage(msg) as Response;
    if(!result.ok) throw new Error(result.error);
    if(result.data.view) apply(result.data.view);
    return result.data;
  } catch(error) {
    const message=String(error);
    if(message.includes('Extension context invalidated')) {cleanup();return;}
    const target=host?.shadowRoot?.querySelector('.br-error');if(target)target.textContent='操作未完成，请重试。'+(error instanceof Error?error.message:'');
  }
}
function apply(view:PageView) {
  if(stopped || view.url!==location.href) return;
  current=view;
  if(!view.rule) {if(host) clear();return;}
  if(!document.documentElement) return;
  const rule=view.rule;
  const next=`${view.url}|${rule.id}|${rule.action}|${rule.message}|${rule.buttonText}|${view.waitUntil}|${rule.name}|${view.reason}`;
  if(signature===next && host?.isConnected) {updateCountdown();return;}
  clear();signature=next;focusBefore=document.activeElement;
  host=element('div');host.id='behavior-rules-root';
  // The browser top layer prevents normal page stacking contexts from covering the blocker.
  const shadow=host.attachShadow({mode:'open'});
  const style=element('style',css);shadow.append(style);
  const reminder=rule.action==='remind';
  const card=element('section',undefined,reminder?'br-toast':'br-card');
  card.setAttribute('aria-label',`停一下 · 网页行为规则：${rule.name}`);
  if(reminder) {card.setAttribute('role','region');card.setAttribute('aria-live','polite');}
  card.append(element('p','停一下 · 网页行为规则 · '+({remind:'轻轻提醒',delay:'稍等一下',block:'为此刻留一点专注'}[rule.action]),'br-label'));
  if(!reminder) card.append(element('div',rule.action==='delay'?'◷':'Ⅱ','br-mark'));
  const title=element('h1',rule.action==='remind'?'记得你为自己定下的约定':rule.action==='delay'?'停一下，再决定':'这段时间，先不打开它');title.id='br-title';card.append(title);
  card.append(element('p',rule.message,'br-message'));
  card.append(element('div',`正在生效：${rule.name}\n${view.reason}${view.matchedNames.length>1?' · 同时匹配 '+view.matchedNames.length+' 条规则':''}`,'br-rule'));
  if(rule.action==='delay') {count=element('div','','br-time');count.setAttribute('aria-label','剩余等待时间');card.append(count);}
  const actions=element('div',undefined,'br-actions');
  primary=element('button',rule.buttonText,'br-primary');primary.type='button';
  primary.addEventListener('click',async()=>{
    if(primary)primary.disabled=true;
    await request(rule.action==='block'?{type:'CLOSE_TAB'}:{type:'ACK',ruleId:rule.id,pageUrl:view.url});
    if(primary)primary.disabled=false;updateCountdown();
  });
  const manage=element('button','管理规则','br-secondary');manage.type='button';manage.onclick=()=>{void request({type:'OPEN_OPTIONS'});};
  actions.append(primary,manage);card.append(actions);
  card.append(element('p',rule.action==='block'?'主按钮会关闭当前标签页。需要临时访问时，可在插件弹窗或管理页放行 15 分钟。':rule.action==='delay'?'倒计时结束后点击按钮继续。刷新保留进度；离开这个网址后，下次访问会重新等待。':'确认后，本标签页刷新不会重复提醒；离开这个网址后，下次访问会再次提醒。','br-foot'));
  const error=element('p','','br-error');error.setAttribute('role','alert');card.append(error);
  if(reminder) shadow.append(card);else {
    dialog=element('dialog',undefined,'br-dialog');dialog.setAttribute('aria-labelledby','br-title');dialog.append(card);
    dialog.addEventListener('cancel',event=>event.preventDefault());shadow.append(dialog);
  }
  document.documentElement.append(host);
  if(dialog) {dialog.showModal();primary.focus();document.querySelectorAll('video,audio').forEach(media=>{try{(media as HTMLMediaElement).pause();}catch{}});}
  updateCountdown();
}
function updateCountdown() {
  if(current?.rule?.action==='delay' && count && primary) {
    const left=Math.max(0,Math.ceil(((current.waitUntil||Date.now())-Date.now())/1000));
    count.textContent=left>0?`${left} 秒`:'可以继续了';primary.disabled=left>0;
  }
}
async function tick() {
  if(stopped||inflight)return;
  const changed=lastUrl!==location.href;lastUrl=location.href;
  if(changed)clear();
  if(document.visibilityState==='hidden' && !changed) return;
  inflight=true;try{await request({type:'TICK'});}finally{inflight=false;}
  if(current?.rule && !host?.isConnected)apply(current);
}
const listener=(msg:{type:string;view?:PageView})=>{if(msg.type==='APPLY_VIEW'&&msg.view)apply(msg.view);};
chrome.runtime.onMessage.addListener(listener);
const timer=window.setInterval(()=>{updateCountdown();void tick();},1000);
const onVisibility=()=>{void tick();};
document.addEventListener('visibilitychange',onVisibility);
window.addEventListener('pageshow',onVisibility);
window.addEventListener('popstate',onVisibility);
window.addEventListener('hashchange',onVisibility);
function cleanup(){stopped=true;clearInterval(timer);clear();chrome.runtime.onMessage.removeListener(listener);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pageshow',onVisibility);window.removeEventListener('popstate',onVisibility);window.removeEventListener('hashchange',onVisibility);}
scope.__behaviorRulesCleanup=cleanup;
void request({type:'TICK'});
