import { chromium } from 'playwright';
import path from 'node:path';
const fixtures=path.resolve('tests/fixtures/load-probe');
for (const [label,executablePath] of [['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],['chrome','C:/Program Files/Google/Chrome/Application/chrome.exe']]) {
 let context;
 try {
  context=await chromium.launchPersistentContext(path.resolve('../../work/probe-'+label),{executablePath,headless:false,args:['--enable-unsafe-extension-debugging','--no-first-run','--disable-extensions-except='+fixtures,'--load-extension='+fixtures]});
  console.log(label,context.browser().version());
  let workers=context.serviceWorkers();
  if (!workers.length) {try {workers=[await context.waitForEvent('serviceworker',{timeout:6000})];}catch{}}
  console.log('flag workers',workers.map(w=>w.url()));
  const page=await context.newPage();
  const session=await context.newCDPSession(page);
  try {console.log('CDP load',await session.send('Extensions.loadUnpacked',{path:fixtures}));}catch(e){console.log('CDP error',e.message);}
  console.log('workers',context.serviceWorkers().map(w=>w.url()));
 } catch(e) {console.log(label,'ERROR',e.message);}
 finally {await context?.close();}
}
