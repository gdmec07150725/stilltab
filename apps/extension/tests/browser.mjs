import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

// Tests only touch an isolated profile, this project's artifacts, and a local HTTP fixture.
const root=path.resolve('../..');
const dist=path.resolve('dist');
await fs.access(path.join(dist,'manifest.json')); // Missing build is a hard failure.
const browserName=process.env.TEST_BROWSER || 'edge';
const executablePath=browserName==='chrome' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const profile=path.join(root,'work','browser-profiles',`${browserName}-${runId}`);
const evidence=path.join(root,'work','browser-evidence',`${browserName}-${runId}`);
await fs.mkdir(evidence,{recursive:true});
const focusPattern=process.env.TEST_FOCUS ? new RegExp(process.env.TEST_FOCUS) : null;
const results={focus:process.env.TEST_FOCUS||null,browser:browserName,version:'',startedAt:new Date().toISOString(),profile,checks:[],screenshots:[],notes:[]};
const server=http.createServer((request,response)=>{
 response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
 response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>行为规则测试网页</title><style>body{font:18px system-ui;margin:60px;color:#253e36;background:#f6f8f5}main{max-width:740px;margin:auto;padding:50px;background:white;border-radius:20px}a{color:#087e70}h1{font-size:38px}</style><main><p>本地体验网页</p><h1>把时间留给自己选择的事。</h1><p>这是用于扩展验收的本地页面。规则生效后，这里会出现提醒、等待或拦截界面。</p><p>当前路径：<code>${request.url?.replace(/[<>&"]/g,'')}</code></p><a href="/focus/article">专注区文章</a> · <a href="/focus/allowed">例外页面</a> · <a href="/other">其他页面</a><p><button id="spa" onclick="history.pushState({},'', '/focus/spa')">切换到 SPA 路径</button></p></main></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let context,worker,options,page,extensionId,pageTabId;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stamp=()=>Date.now();
const rid=label=>Buffer.from(label).toString("hex");
const makeRule=(id,extra={})=>({id:rid(id),name:`验收 · ${id}`,enabled:true,match:{kind:'site',value:base,includeSubdomains:false,ignoreQuery:false,ignoreHash:true},exceptions:[],schedule:{enabled:false,days:[0,1,2,3,4,5,6],start:'00:00',end:'00:00'},quotaMinutes:0,action:'block',delaySeconds:2,message:'先停一下，把注意力留给真正重要的事。',buttonText:'关闭此页',priority:0,createdAt:stamp(),...extra});
async function launch(){
 context=await chromium.launchPersistentContext(profile,{executablePath,headless:false,viewport:{width:1280,height:900},locale:'zh-CN',args:['--no-first-run','--enable-unsafe-extension-debugging','--disable-extensions-except='+dist,'--load-extension='+dist]});
 results.version=context.browser().version();
 worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:12000});
 extensionId=worker.url().split('/')[2];
 options=await context.newPage();
 await options.goto(`chrome-extension://${extensionId}/options.html`);
 await options.waitForLoadState('domcontentloaded');
}
async function raw(message){message={...message};if(message.id)message.id=rid(message.id);return options.evaluate(message=>chrome.runtime.sendMessage(message),message);}
async function send(message){const result=await raw(message);assert.equal(result.ok,true,result.error);return result.data;}
async function state(){return send({type:'GET_STATE',tabId:pageTabId});}
async function clear(){await send({type:'IMPORT_CONFIG',config:{version:1,rules:[]}});}
async function save(rule){return send({type:'SAVE_RULE',rule});}
async function focus(target=page){
 await target.bringToFront();
 const tab=await options.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),target.url());
 assert.ok(tab?.id,'Target browser tab exists');
 await options.evaluate(async ({id,windowId})=>{await chrome.windows.update(windowId,{focused:true});await chrome.tabs.update(id,{active:true});},{id:tab.id,windowId:tab.windowId});
 if(target===page)pageTabId=tab.id;
}
async function navigate(url){await page.goto(url);await focus();}
async function overlay(expected=true,target=page){await target.locator('#behavior-rules-root').waitFor({state:expected?'attached':'detached',timeout:6000});}
async function screenshot(name,target=page){const file=path.join(evidence,name+'.png');await target.screenshot({path:file,fullPage:true});results.screenshots.push(file);}
async function check(name,fn){if(focusPattern&&!focusPattern.test(name))return;const at=stamp();try{await fn();results.checks.push({name,pass:true,ms:stamp()-at});console.log('PASS',name);}catch(error){results.checks.push({name,pass:false,ms:stamp()-at,error:error.stack});console.error('FAIL',name,error.message);throw error;}}
async function contentRequest(target,message){
 if(message.type==='ACK'&&!message.pageUrl)message={...message,pageUrl:target.url()};
 const cdp=await context.newCDPSession(target);const worlds=[];
 cdp.on('Runtime.executionContextCreated',event=>worlds.push(event.context));
 await cdp.send('Runtime.enable');
 const world=worlds.find(w=>w.origin===`chrome-extension://${extensionId}` || w.name?.includes(extensionId));
 assert.ok(world,`Extension isolated world exists: ${JSON.stringify(worlds.map(w=>({name:w.name,origin:w.origin})))}`);
 const value=await cdp.send('Runtime.evaluate',{expression:`chrome.runtime.sendMessage(${JSON.stringify(message)})`,contextId:world.id,awaitPromise:true,returnByValue:true});
 await cdp.detach();return value.result.value;
}
async function restartWorker(){
 const cdp=await context.newCDPSession(options);const versions=[];cdp.on('ServiceWorker.workerVersionUpdated',event=>versions.push(...event.versions));await cdp.send('ServiceWorker.enable');for(let i=0;i<30&&!versions.some(v=>v.scriptURL.includes(extensionId));i++)await sleep(50);const version=versions.find(v=>v.scriptURL.includes(extensionId));assert.ok(version,'Extension service worker version is observable');await worker.evaluate(()=>{globalThis.__behaviorRulesRestartProbe='before-stop';});await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});for(let i=0;i<40&&!versions.some(v=>v.runningStatus==='stopped');i++)await sleep(50);assert.ok(versions.some(v=>v.runningStatus==='stopped'),'Browser confirms service worker stopped');await state();assert.equal(await worker.evaluate(()=>globalThis.__behaviorRulesRestartProbe),undefined,'Worker global memory was recreated');await cdp.detach();results.notes.push({workerRestart:'CDP stopWorker confirmed STOPPED; global marker disappeared after runtime message wake'});
}
async function usage(id){id=rid(id);const s=await state();return Object.values(s.usage).reduce((sum,day)=>sum+(day[id]||0),0);}
let fatal;
try{
 await launch();
 page=await context.newPage();await navigate(base+'/start');
 await check('首次安装：没有自动启用规则，网页可正常浏览',async()=>{assert.deepEqual((await state()).config.rules,[]);await overlay(false);});
 await check('已打开标签页立即执行网站规则；提示语及规则名可见',async()=>{await save(makeRule('整站拦截'));await overlay();assert.match(await page.locator('.br-rule').innerText(),/验收 · 整站拦截/);await screenshot('01-block');});
 await check('普通页面不能发送保存配置操作',async()=>{const response=await contentRequest(page,{type:'IMPORT_CONFIG',config:{version:1,rules:[]}});assert.equal(response.ok,false);assert.equal((await state()).config.rules.length,1);});
 await check('路径边界与例外：匹配后代，排除指定链接，不误伤相似路径',async()=>{
  await clear();await save(makeRule('路径与例外',{match:{kind:'path',value:base+'/focus',includeSubdomains:false,ignoreQuery:true,ignoreHash:true},exceptions:[{kind:'page',value:base+'/focus/allowed',includeSubdomains:false,ignoreQuery:false,ignoreHash:true}]}));
  await navigate(base+'/focus/article');await overlay();await navigate(base+'/focus/allowed');await overlay(false);await navigate(base+'/focus-extra');await overlay(false);
 });
 await check('具体页面：query 精确匹配，默认忽略 hash，刷新仍执行',async()=>{
  await clear();await save(makeRule('具体页面',{match:{kind:'page',value:base+'/exact?id=1',includeSubdomains:false,ignoreQuery:false,ignoreHash:true}}));
  await navigate(base+'/exact?id=2');await overlay(false);await navigate(base+'/exact?id=1#section');await overlay();await page.reload();await overlay();
 });
 await check('SPA history.pushState 与 hash 变化重新判断',async()=>{
  await clear();await save(makeRule('SPA',{match:{kind:'path',value:base+'/focus',includeSubdomains:false,ignoreQuery:true,ignoreHash:true}}));
  await navigate(base+'/outside');await overlay(false);await page.evaluate(()=>history.pushState({},'', '/focus/spa'));await overlay();await page.evaluate(()=>history.pushState({},'', '/outside'));await overlay(false);
  await clear();await save(makeRule('Hash',{match:{kind:'page',value:base+'/outside#blocked',includeSubdomains:false,ignoreQuery:false,ignoreHash:false}}));await page.evaluate(()=>{location.hash='blocked';});await overlay();await page.evaluate(()=>{location.hash='free';});await overlay(false);
 });
 await check('仅提醒：页面仍可操作，确认在刷新后保留，离开网址后失效',async()=>{
  await clear();await navigate(base+'/remind');await save(makeRule('温和提醒',{action:'remind',buttonText:'我知道了'}));await overlay();assert.equal(await page.locator('dialog[open]').count(),0);await screenshot('02-remind');await page.getByRole('button',{name:'我知道了',exact:true}).click();await overlay(false);await page.reload();await overlay(false);await page.evaluate(()=>{history.pushState({},'', '/other');history.pushState({},'', '/remind');});await overlay();await page.getByRole('button',{name:'我知道了',exact:true}).click();await overlay(false);await navigate(base+'/other');await overlay();
 });
 await check('导航竞争：旧网页的确认不能放行导航后的新网页',async()=>{
  await clear();await navigate(base+'/ack-a');await save(makeRule('导航确认',{action:'remind',buttonText:'确认当前网页'}));await overlay();const oldUrl=page.url();await page.evaluate(()=>history.pushState({},'', '/ack-b'));await overlay();const stale=await contentRequest(page,{type:'ACK',ruleId:rid('导航确认'),pageUrl:oldUrl});assert.equal(stale.ok,false,'Stale page acknowledgment must be rejected');assert.equal((await state()).view.rule.id,rid('导航确认'));await overlay();await page.getByRole('button',{name:'确认当前网页',exact:true}).click();await overlay(false);
 });
 await check('等待：提前确认被后台拒绝，倒计时后放行且刷新保留',async()=>{
  await clear();await navigate(base+'/delay');await save(makeRule('等一等',{action:'delay',delaySeconds:5,buttonText:'继续浏览'}));await overlay();assert.equal(await page.getByRole('button',{name:'继续浏览',exact:true}).isDisabled(),true);const early=await contentRequest(page,{type:'ACK',ruleId:rid('等一等')});assert.equal(early.ok,false);assert.match(early.error,/倒计时/);await screenshot('03-delay');const deadline=(await state()).view.waitUntil;await restartWorker();assert.equal((await state()).view.waitUntil,deadline,'Worker wake preserves the pending countdown');await page.getByRole('button',{name:'继续浏览',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#behavior-rules-root')?.shadowRoot?.querySelector('.br-primary')?.disabled);await page.getByRole('button',{name:'继续浏览',exact:true}).click();await overlay(false);await page.reload();await overlay(false);
 });
 await check('直接拦截：Esc 不绕过；主按钮关闭标签页',async()=>{
  await clear();await save(makeRule('关闭测试'));const closePage=await context.newPage();await closePage.goto(base+'/close');await focus(closePage);await overlay(true,closePage);await closePage.keyboard.press('Escape');await overlay(true,closePage);const closed=closePage.waitForEvent('close');await closePage.getByRole('button',{name:'关闭此页',exact:true}).click();await closed;await focus();
 });
 await check('冲突优先级：拦截优先于提醒；单条规则例外不豁免其他规则',async()=>{
  await clear();await navigate(base+'/conflict');await save(makeRule('低级提醒',{action:'remind',priority:100,buttonText:'收到'}));await save(makeRule('高级拦截',{exceptions:[{kind:'page',value:base+'/exception',includeSubdomains:false,ignoreQuery:false,ignoreHash:true}]}));await overlay();assert.equal((await state()).view.rule.id,rid('高级拦截'));await navigate(base+'/exception');await overlay();assert.equal((await state()).view.rule.id,rid('低级提醒'));
 });
 await check('指定星期与时段：当前时段执行，未选日期或不在时段不执行',async()=>{
  await clear();await navigate(base+'/schedule');const day=new Date().getDay();let rule=makeRule('时段',{schedule:{enabled:true,days:[day],start:'00:00',end:'00:00'}});await save(rule);await overlay();rule={...rule,schedule:{...rule.schedule,days:[(day+1)%7]}};await save(rule);await overlay(false);
  const now=new Date();const hour=(now.getHours()+2)%24;const start=String(hour).padStart(2,'0')+':00';const end=String((hour+1)%24).padStart(2,'0')+':00';await save({...rule,schedule:{enabled:true,days:[0,1,2,3,4,5,6],start,end}});await overlay(false);
 });
 await check('临时放行与撤回立即生效；其他冲突规则继续判断',async()=>{
  await clear();await navigate(base+'/bypass');await save(makeRule('可放行'));await overlay();await send({type:'BYPASS',id:'可放行'});await overlay(false);await save(makeRule('仍然提醒',{action:'remind',buttonText:'明白'}));await overlay();assert.equal((await state()).view.rule.id,rid('仍然提醒'));await send({type:'DELETE_RULE',id:'仍然提醒'});await overlay(false);await send({type:'REVOKE_BYPASS',id:'可放行'});await overlay();
 });
 await check('修改、启停和删除会更新当前页面；触发记录保存在本地',async()=>{
  await send({type:'TOGGLE_RULE',id:'可放行',enabled:false});await overlay(false);await send({type:'TOGGLE_RULE',id:'可放行',enabled:true});await overlay();await send({type:'DELETE_RULE',id:'可放行'});await overlay(false);assert.ok((await state()).logs.some(entry=>entry.action==='block'));
 });
 await check('导入验证：损坏配置不覆盖已有配置；有效 JSON 可往返导入',async()=>{
  await clear();await save(makeRule('导入保存',{enabled:false}));const before=(await state()).config;const broken=await raw({type:'IMPORT_CONFIG',config:{version:999,rules:[]}});assert.equal(broken.ok,false);assert.deepEqual((await state()).config,before);await send({type:'IMPORT_CONFIG',config:JSON.parse(JSON.stringify(before))});assert.deepEqual((await state()).config,before);
 });
 await check('导入边界：Unicode 归一化后超长地址被拒绝，正常地址可重启后读取',async()=>{
  await clear();const valid=makeRule('Unicode正常',{enabled:false,match:{kind:'page',value:base+'/'+ '中'.repeat(20)+'?q=正常',includeSubdomains:false,ignoreQuery:false,ignoreHash:true}});await save(valid);const before=(await state()).config;const oversized=makeRule('Unicode超长',{enabled:false,match:{...valid.match,value:base+'/'+ '中'.repeat(500)}});const rejected=await raw({type:'SAVE_RULE',rule:oversized});assert.equal(rejected.ok,false);assert.deepEqual((await state()).config,before);await send({type:'IMPORT_CONFIG',config:JSON.parse(JSON.stringify(before))});await restartWorker();assert.deepEqual((await state()).config,before);
 });
 await check('继承属性同名规则 ID 仍正常等待，不能提前确认',async()=>{
  await clear();await navigate(base+'/prototype-id');await save({...makeRule('继承属性ID'),id:'toString',action:'delay',delaySeconds:3,buttonText:'继续测试'});await overlay();const deadline=(await state()).view.waitUntil;assert.equal(typeof deadline,'number');assert.ok(deadline>Date.now());assert.equal(await page.getByRole('button',{name:'继续测试',exact:true}).isDisabled(),true);const early=await contentRequest(page,{type:'ACK',ruleId:'toString'});assert.equal(early.ok,false);assert.match(early.error,/倒计时/);await clear();await overlay(false);
 });
 await check('前台单标签计时：两个匹配标签不重复累加，后台标签不单独累加',async()=>{
  await clear();await navigate(base+'/time-a');await save(makeRule('前台额度',{quotaMinutes:1}));const other=await context.newPage();await other.goto(base+'/time-b');await focus();await sleep(500);const before=await usage('前台额度');const started=stamp();await sleep(3200);const delta=(await usage('前台额度'))-before;const wall=stamp()-started;assert.ok(delta>=2300 && delta<=wall+1500,`Single foreground delta=${delta},wall=${wall}`);
  await focus(options);const beforeBackground=await usage('前台额度');await sleep(2200);const backgroundDelta=(await usage('前台额度'))-beforeBackground;assert.ok(backgroundDelta<800,`Background delta=${backgroundDelta}`);await other.close();await focus();results.notes.push({foregroundMeasurement:{deltaMs:delta,wallMs:wall,backgroundDeltaMs:backgroundDelta}});
 });
 await check('跨窗口计时：仅被聚焦窗口中的活动页累加',async()=>{
  await clear();await navigate(base+'/window-a');await save(makeRule('多窗口额度',{quotaMinutes:1}));const newWindow=await options.evaluate(async url=>chrome.windows.create({url,type:'normal',focused:true}),base+'/window-b');const second=await context.waitForEvent('page',{timeout:5000}).catch(()=>context.pages().find(p=>p.url()===base+'/window-b'));assert.ok(second);await second.waitForLoadState();await focus(second);const before=await usage('多窗口额度');const started=stamp();await sleep(2500);const delta=(await usage('多窗口额度'))-before;const wall=stamp()-started;assert.ok(delta>=1600&&delta<=wall+1400,`Multiple windows delta=${delta},wall=${wall}`);await options.evaluate(id=>chrome.windows.remove(id),newWindow.id);await focus();results.notes.push({multiWindowMeasurement:{deltaMs:delta,wallMs:wall}});
 });
 await check('额度达到后拦截；被拦截页面不再累加时长',async()=>{
  // Seed only the elapsed-time fixture, then let actual foreground time cross the one-minute quota.
  await clear();await navigate(base+'/quota');await save(makeRule('用量到达',{quotaMinutes:1}));
  await worker.evaluate(async id=>{const key='behaviorRulesState';const state=(await chrome.storage.local.get(key))[key];const d=new Date();const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;state.usage[date]={[id]:58000};await chrome.storage.local.set({[key]:state});},rid('用量到达'));
  results.notes.push({quotaThresholdFixture:{seedMs:58000,quotaMs:60000,actualForegroundCrossing:true}});
  // Worker restart must rehydrate the seeded durable state, never rely on its old in-memory copy.
  await restartWorker();await focus();await overlay();const before=await usage('用量到达');await sleep(2200);const delta=(await usage('用量到达'))-before;assert.ok(delta<800,`Blocked delta=${delta}`);
 });
 await check('临时放行真实到期后恢复拦截（1 分钟）',async()=>{
  await clear();await navigate(base+'/expiry');await save(makeRule('到期恢复'));await send({type:'BYPASS',id:'到期恢复',minutes:1});await overlay(false);const grant=(await state()).grants.find(g=>g.ruleId===rid('到期恢复'));assert.ok(grant);while(stamp()<grant.expiresAt+200){await sleep(Math.min(1000,Math.max(1,grant.expiresAt+200-stamp())));}await overlay();assert.equal((await state()).grants.length,0);
 });
 await check('浏览器重启保留配置、用量、记录和未过期临时放行',async()=>{
  await send({type:'BYPASS',id:'到期恢复'});await focus();await sleep(2300);const before=await state();const beforeUsage=await usage('到期恢复');assert.ok(beforeUsage>=1500,'Persistence starts with actual nonzero browsing usage');await context.close();await sleep(1800);await launch();page=await context.newPage();await navigate(base+'/expiry');await overlay(false);const after=await state();assert.deepEqual(after.config,before.config);assert.deepEqual(after.grants,before.grants);assert.ok(after.logs.length>=before.logs.length);const afterUsage=await usage('到期恢复');assert.ok(afterUsage>=beforeUsage,`Usage survives restart: before=${beforeUsage},after=${afterUsage}`);assert.ok(afterUsage-beforeUsage<1400,`Offline/browser startup time was not charged: delta=${afterUsage-beforeUsage}`);results.notes.push({restartUsage:{beforeMs:beforeUsage,afterMs:afterUsage}});await send({type:'REVOKE_BYPASS',id:'到期恢复'});await overlay();
 });
 await check('表单切换：隐藏的等待秒数和时段字段不会阻塞保存',async()=>{
  await clear();await focus(options);await options.reload();await options.locator('[data-command="new"]').first().click();await options.locator('#rule-name').fill('隐藏字段切换验收');await options.locator('#rule-url').fill(base);await options.locator('input[name="action"][value="delay"]').check();await options.locator('#delay-seconds').fill('');await options.locator('input[name="action"][value="block"]').check();assert.equal(await options.locator('#rule-form').evaluate(form=>form.checkValidity()),true,'Inactive empty delay field is excluded from validation');await options.locator('#schedule-enabled').check();await options.locator('#start-time').fill('');await options.locator('#schedule-enabled').uncheck();assert.equal(await options.locator('#rule-form').evaluate(form=>form.checkValidity()),true,'Inactive empty time field is excluded from validation');await options.locator('#save-rule').click();await options.locator('#rule-form').waitFor({state:'hidden'});const saved=(await state()).config.rules.find(rule=>rule.name==='隐藏字段切换验收');assert.ok(saved);assert.equal(saved.action,'block');assert.equal(saved.schedule.enabled,false);
 });
 await check('普通表单点选、句子预览、例外编辑与保存可实际使用',async()=>{
  await clear();await focus(options);await options.reload();await options.locator('[data-command="new"]').first().click();await options.locator('#rule-name').fill('每天留一点专注时间');await options.locator('#rule-url').fill(base+'/focus');await options.locator('input[name="kind"][value="path"]').check();await options.locator('input[name="action"][value="delay"]').check();await options.locator('#delay-seconds').fill('5');await options.locator('#rule-message').fill('先深呼吸，再决定要不要继续浏览。');await options.locator('#button-text').fill('想清楚了，继续');await options.locator('#rule-enabled').check();assert.match(await options.locator('#sentence-preview').innerText(),/5 秒/);assert.match(await options.locator('#effect-preview').innerText(),/先深呼吸/);await options.locator('dialog[open]').evaluate(element=>{element.scrollTop=0;});await screenshot('06-editor-preview',options);await options.locator('summary').click();await options.locator('#exception-url').fill(base+'/focus/allowed');await options.locator('#add-exception').click();assert.equal(await options.locator('.exception-row').count(),1);await options.locator('#save-rule').click();await options.locator('#rule-form').waitFor({state:'hidden'});const saved=(await state()).config.rules.find(rule=>rule.name==='每天留一点专注时间');assert.ok(saved?.enabled);assert.equal(saved.exceptions.length,1);await navigate(base+'/focus/allowed');await overlay(false);await navigate(base+'/focus/article');await overlay();
 });
 await check('模板不会直接保存规则；导出文件与导入预览确认工作正常',async()=>{
  await focus(options);let before=(await state()).config;await options.locator('[data-nav="templates"]').click();await screenshot('07-templates',options);await options.locator('[data-command="template"]').first().click();assert.deepEqual((await state()).config,before);await options.locator('dialog[open] .cancel').click();await save(makeRule('外部新增',{name:'睡前少刷一会儿',enabled:false}));before=(await state()).config;await options.locator('[data-nav="settings"]').click();const downloaded=options.waitForEvent('download');await options.locator('[data-command="export"]').click();const download=await downloaded;const exportFile=path.join(evidence,'exported-config.json');await download.saveAs(exportFile);const exported=JSON.parse(await fs.readFile(exportFile,'utf8'));assert.deepEqual(exported,before);await options.locator('#import-file').setInputFiles(exportFile);assert.match(await options.locator('dialog[open]').innerText(),/检查要导入/);await options.locator('.confirm-import').click();await options.locator('.confirm-import').waitFor({state:'hidden'});assert.deepEqual((await state()).config,before);
 });
 await check('管理页与快速创建弹窗真实渲染，保留截图',async()=>{
  await focus(options);await options.reload();await screenshot('08-settings',options);await options.locator('[data-nav=rules]').click();await screenshot('04-options',options);await navigate(base+'/focus/article?from=popup#top');
  const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${pageTabId}`);await popup.setViewportSize({width:420,height:780});await popup.locator('#quick-add').waitFor();assert.equal(await popup.locator('#quick-add').isEnabled(),true);assert.match(await popup.locator('.popup-site').innerText(),/127.0.0.1/);await screenshot('05-popup',popup);await popup.locator('#quick-scope').selectOption('page');await popup.locator('#quick-add').click();await popup.getByText('提醒规则已创建并启用。',{exact:true}).waitFor();assert.ok((await state()).config.rules.some(rule=>rule.action==='remind'&&rule.match.kind==='page'&&rule.match.value===page.url()));await popup.locator('#quick-scope').selectOption('path');const opened=context.waitForEvent('page');await popup.locator('#custom-add').click();const custom=await opened;await custom.locator('#rule-url').waitFor();assert.equal(await custom.locator('#rule-url').inputValue(),page.url());assert.equal(await custom.locator('input[name="kind"][value="path"]').isChecked(),true);await custom.close();if(!popup.isClosed())await popup.close();
 });
} catch(error){fatal=error;console.error(error.stack);} finally{
 results.finishedAt=new Date().toISOString();results.passed=results.checks.filter(c=>c.pass).length;results.failed=results.checks.filter(c=>!c.pass).length;results.fatal=fatal?.message;
 await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(results,null,2));await fs.writeFile(path.join(root,'work',`browser-results-${browserName}${focusPattern?"-focused":""}.json`),JSON.stringify(results,null,2));
 console.log('EVIDENCE',evidence);console.log('SUMMARY',JSON.stringify({browser:results.browser,version:results.version,passed:results.passed,failed:results.failed,fatal:results.fatal}));
 await context?.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));
}
if(fatal)process.exitCode=1;
