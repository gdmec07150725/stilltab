import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

// This fixture uses a fresh profile and synthetic demonstration rules only.
// No user profile, real browsing data, network site, or store account is read.
const root = path.resolve('../..');
const dist = path.resolve('dist');
const out = path.join(root, 'docs/store/screenshots');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const profile = path.join(root, 'work/browser-profiles', `store-${runId}`);
const evidence = path.join(root, 'work/browser-evidence', `store-${runId}`);
await fs.mkdir(out, {recursive:true});
await fs.mkdir(evidence, {recursive:true});
const manifest = JSON.parse(await fs.readFile(path.join(dist,'manifest.json'), 'utf8'));
assert.equal(manifest.version, '1.0.1');
assert.equal(manifest.name, '停一下 · 网页行为规则');
assert.ok(!manifest.permissions.includes('tabs'));
const digest = async () => Object.fromEntries(await Promise.all(['manifest.json','background.js','content.js','options.js','popup.js','styles.css','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png'].map(async file => [file,crypto.createHash('sha256').update(await fs.readFile(path.join(dist,file))).digest('hex')])));
const report = {startedAt:new Date().toISOString(),extensionVersion:manifest.version,profile,distSha256:await digest(),screenshots:[],checks:[],notes:['Screenshots show genuine 1.0.1 UI populated with synthetic demonstration rules. No DOM branding or UI text has been replaced.']};
const server = http.createServer((request,response)=>{
  response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>停一下 · 功能演示网页</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6f1;color:#294b40;font:16px "Microsoft YaHei",system-ui,sans-serif}.header{padding:32px 64px;border-bottom:1px solid #dce5d9;display:flex;justify-content:space-between;font-size:13px;color:#6f836d}.wrap{max-width:920px;margin:66px auto}.tag{font-size:12px;letter-spacing:2px;color:#70856f}h1{font-weight:500;font-size:42px;margin:20px 0 25px}p{line-height:1.9;max-width:700px;color:#6d7f6b}.article{margin-top:40px;padding:32px;background:white;border:1px solid #dde6d8;border-radius:12px;display:flex;gap:32px}.swatch{width:190px;height:130px;flex:none;border-radius:8px;background:linear-gradient(135deg,#b7cdb9,#e4eddd)}h2{font-size:20px;font-weight:500;margin:0 0 15px}.note{font-size:12px;color:#82927c;margin-top:40px}</style><div class="header"><strong>浏览体验 · 演示页面</strong><span>仅用于展示扩展功能</span></div><main class="wrap"><div class="tag">MAKE ROOM FOR WHAT MATTERS</div><h1>把时间留给自己选择的事。</h1><p>一条适合自己的规则，可以为每一次打开留出片刻。<br>稍作停顿，再决定接下来要做什么。</p><div class="article"><div class="swatch"></div><div><h2>今天，留一点时间给自己</h2><p>读完一篇文章，完成一件小事，或者好好休息。<br>这是本地演示内容，不是真实网站或用户浏览记录。</p></div></div><p class="note">此页面与展示中的规则均为演示数据。</p></main></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let context, options;
const rule = (id,name,extra={}) => ({id,name,enabled:true,match:{kind:'site',value:'https://example.com',includeSubdomains:false,ignoreQuery:false,ignoreHash:true},exceptions:[],schedule:{enabled:false,days:[0,1,2,3,4,5,6],start:'00:00',end:'00:00'},quotaMinutes:0,action:'remind',delaySeconds:30,message:'先深呼吸，再决定要不要继续浏览。',buttonText:'我知道了',priority:0,createdAt:Date.now(),...extra});
async function send(message) {const result=await options.evaluate(message=>chrome.runtime.sendMessage(message),message);assert.equal(result.ok,true,result.error);return result.data;}
async function shot(name,page=options) {
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,images:[...document.images].map(i=>({src:i.getAttribute('src'),width:i.naturalWidth,height:i.naturalHeight,complete:i.complete}))}));
  assert.equal(geometry.width,1280);assert.equal(geometry.height,800);
  assert.ok(geometry.scrollWidth<=geometry.clientWidth,`Unexpected horizontal overflow in ${name}`);
  for (const image of geometry.images) {assert.ok(image.complete && image.width>0,`Image failed to load: ${image.src}`);}
  const file=path.join(out,`${name}.png`);
  await page.screenshot({path:file,fullPage:false});
  report.screenshots.push({file,width:1280,height:800,geometry});
  console.log('SCREENSHOT',file);
}
try {
  context=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:false,viewport:{width:1280,height:800},locale:'zh-CN',args:['--no-first-run','--enable-unsafe-extension-debugging','--disable-extensions-except='+dist,'--load-extension='+dist]});
  report.browserVersion=context.browser().version();
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const extensionId=worker.url().split('/')[2];
  options=await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('.brand img').waitFor();
  assert.match(await options.locator('.brand').innerText(),/停一下/);
  assert.ok(await options.locator('.brand img').evaluate(i=>i.complete&&i.naturalWidth===48));
  const iconChecks=await options.evaluate(async()=>{
    const icons=chrome.runtime.getManifest().icons;
    return await Promise.all(Object.entries(icons).map(([size,file])=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({size:Number(size),width:image.naturalWidth,height:image.naturalHeight,file});image.onerror=()=>resolve({size:Number(size),error:true,file});image.src=chrome.runtime.getURL(file);})));});
  for(const icon of iconChecks) {assert.equal(icon.width,icon.size);assert.equal(icon.height,icon.size);}
  report.checks.push({name:'New brand and all manifest icons load',pass:true,icons:iconChecks});
  const demoRules=[rule('demo-work','演示 · 工作时少刷一会儿',{quotaMinutes:20,schedule:{enabled:true,days:[1,2,3,4,5],start:'09:00',end:'18:00'},message:'今天最重要的事，做完了吗？'}),rule('demo-night','演示 · 夜深了，早点休息',{match:{kind:'site',value:'https://example.org',includeSubdomains:false,ignoreQuery:false,ignoreHash:true},action:'block',schedule:{enabled:true,days:[0,1,2,3,4,5,6],start:'23:00',end:'07:00'},message:'今天已经很充实了，让自己好好休息。',buttonText:'关闭此页'})];
  await send({type:'IMPORT_CONFIG',config:{version:1,rules:demoRules}});
  await options.reload();await options.locator('.rule-card').first().waitFor();
  await shot('01-rules');
  await options.locator('[data-command="new"]').first().click();
  await options.locator('#rule-name').fill('演示 · 打开之前，先等一等');
  await options.locator('#rule-url').fill('https://example.com');
  await options.locator('input[name="action"][value="delay"]').check();
  await options.locator('#delay-seconds').fill('30');
  await options.locator('#rule-message').fill('先深呼吸，再决定要不要继续浏览。');
  await options.locator('#button-text').fill('想清楚了，继续');
  await options.locator('dialog[open]').evaluate(element=>{element.scrollTop=0;});
  await shot('02-editor');
  await options.locator('dialog[open] .cancel').click();
  await options.locator('[data-nav="templates"]').click();
  await shot('03-templates');
  const demoPage=await context.newPage();await demoPage.goto(base+'/demo');
  const delayRule=rule('demo-delay','演示 · 打开之前，先等一等',{match:{kind:'site',value:base,includeSubdomains:false,ignoreQuery:false,ignoreHash:true},action:'delay',delaySeconds:30,buttonText:'想清楚了，继续'});
  await send({type:'SAVE_RULE',rule:delayRule});
  await demoPage.locator('#behavior-rules-root').waitFor({state:'attached'});
  assert.ok(await demoPage.getByRole('button',{name:'想清楚了，继续',exact:true}).isDisabled());
  await shot('04-wait',demoPage);
  await send({type:'DELETE_RULE',id:'demo-delay'});
  await demoPage.locator('#behavior-rules-root').waitFor({state:'detached'});
  await send({type:'SAVE_RULE',rule:{...delayRule,id:'demo-remind',name:'演示 · 给自己一个小提醒',action:'remind',buttonText:'我知道了'}});
  await demoPage.locator('#behavior-rules-root').waitFor({state:'attached'});
  assert.equal(await demoPage.locator('dialog[open]').count(),0);
  await shot('05-reminder',demoPage);
  report.checks.push({name:'Live delay and reminder render on HTTP webpage with demo rules',pass:true});
  const settingsTab=await options.evaluate(()=>chrome.tabs.create({url:'edge://settings/',active:false}));
  const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${settingsTab.id}`);
  await popup.locator('#quick-add').waitFor();
  assert.match(await popup.locator('.current-state').innerText(),/这个页面暂不支持/);
  assert.ok(await popup.locator('#quick-add').isDisabled());
  assert.ok(await popup.locator('#custom-add').isDisabled());
  await popup.setViewportSize({width:420,height:800});
  await popup.screenshot({path:path.join(evidence,'protected-page-popup.png')});
  report.checks.push({name:'Protected edge://settings page shows unsupported and disables quick-create',pass:true,display:await popup.locator('.current-state').innerText()});
  await options.evaluate(id=>chrome.tabs.remove(id),settingsTab.id);
  assert.deepEqual(await digest(),report.distSha256,'Build changed during screenshot capture');
  report.checks.push({name:'dist fingerprints remain unchanged through screenshot capture',pass:true});
} catch(error) {report.error=error.stack;process.exitCode=1;console.error(error.stack);} finally {
  report.finishedAt=new Date().toISOString();
  await fs.writeFile(path.join(out,'capture-report.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(evidence,'capture-report.json'),JSON.stringify(report,null,2));
  await context?.close().catch(()=>{});
  await new Promise(resolve=>server.close(resolve));
  console.log('REPORT',path.join(out,'capture-report.json'));
}
