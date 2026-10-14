import type { Matcher, Snapshot } from './core/types';
import { makeRule } from './core/defaults';
import { actionLabels, displayUrl, duration, errorText, escape as e, request, toast } from './ui';

const app = document.querySelector<HTMLDivElement>('#app')!;
let state: Snapshot;
let tabId: number | undefined;
let currentUrl = '';
let scope: Matcher['kind'] = 'site';


async function refresh(): Promise<void> {
  state = await request({ type: 'GET_STATE', tabId });
  render();
}
function render(): void {
  const view = state.view;
  const supported = view?.supported ?? /^https?:\/\//.test(currentUrl);
  const rule = view?.rule;
  const grants = state.grants.filter(item => item.expiresAt > state.now);
  app.innerHTML = `<header class="popup-header"><div class="brand"><img class="brand-mark" src="icons/icon48.png" alt=""><span>停一下<small>网页行为规则</small></span></div><button type="button" class="text-button" id="settings">管理规则 →</button></header><main class="popup-main"><div class="tiny-label">当前网页</div><h1 class="popup-site" title="${e(currentUrl)}">${e(currentUrl ? displayUrl(currentUrl) : '无法读取当前网页')}</h1><section class="current-state ${rule ? rule.action : 'free'}"><div class="state-top"><span class="state-light"></span><strong>${!supported ? '这个页面暂不支持' : rule ? `正在生效 · ${actionLabels[rule.action]}` : '当前可以自由浏览'}</strong></div>${rule ? `<h2>${e(rule.name)}</h2>` : ''}<p>${e(view?.reason || (supported ? '没有规则正在限制这个网页。' : '浏览器设置、扩展商店及受保护页面无法执行网页规则。'))}</p>${rule?.quotaMinutes ? `<div class="popup-usage">今日已用 ${duration(view?.usedMs || 0)} / ${rule.quotaMinutes} 分钟</div>` : ''}${rule ? `<button type="button" class="button full-width" id="bypass">将这条规则放行 15 分钟</button>` : ''}${view?.matchedNames.length ? `<div class="matched-rules">匹配到：${e(view.matchedNames.join('、'))}</div>` : ''}</section>${grants.length ? `<details class="popup-grants"><summary>${grants.length} 条规则正在临时放行</summary>${grants.map(grant => `<div><span>${e(state.config.rules.find(item => item.id === grant.ruleId)?.name || '已移除的规则')}<small>剩余约 ${Math.max(1, Math.ceil((grant.expiresAt - state.now) / 60000))} 分钟</small></span><button type="button" class="text-button" data-revoke="${e(grant.ruleId)}">结束放行</button></div>`).join('')}</details>` : ''}<section class="quick-create"><div class="section-heading"><h2>给当前网页加条规则</h2></div><label class="field-label" for="quick-scope">应用范围</label><select id="quick-scope" ${!supported ? 'disabled' : ''}><option value="site" ${scope === 'site' ? 'selected' : ''}>整个网站</option><option value="path" ${scope === 'path' ? 'selected' : ''}>当前路径及下级路径</option><option value="page" ${scope === 'page' ? 'selected' : ''}>仅这个具体页面</option></select><div class="quick-actions"><button type="button" class="button primary" id="quick-add" ${!supported ? 'disabled' : ''}>创建提醒规则</button><button type="button" class="button" id="custom-add" ${!supported ? 'disabled' : ''}>自定义…</button></div><p class="help-text">快捷创建：每天、全天，仅提醒。可随时编辑时段和处理方式。</p></section></main><footer class="popup-footer"><span class="local-indicator"></span> 本机保存 · ${state.config.rules.filter(item => item.enabled).length} 条规则已启用<button type="button" class="text-button" id="refresh">刷新状态</button></footer>`;
  app.querySelector('#settings')!.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  app.querySelector('#refresh')!.addEventListener('click', () => void withError(refresh));
  app.querySelector<HTMLSelectElement>('#quick-scope')!.addEventListener('change', event => { scope = (event.target as HTMLSelectElement).value as Matcher['kind']; });
  app.querySelector('#custom-add')!.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?url=${encodeURIComponent(currentUrl)}&scope=${scope}`) });
    window.close();
  });
  app.querySelector('#quick-add')!.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true; button.textContent = '正在创建…';
    await withError(async () => {
      const rule = makeRule(currentUrl); rule.match.value = currentUrl; rule.enabled = true; rule.match.kind = scope; rule.action = 'remind'; rule.quotaMinutes = 0; rule.schedule.enabled = false; rule.buttonText = '知道了';
      rule.name = `${new URL(currentUrl).hostname} · 浏览提醒`.slice(0, 80);
      await request({ type: 'SAVE_RULE', rule }); await refresh(); toast('提醒规则已创建并启用。');
    });
    button.disabled = false; button.textContent = '创建提醒规则';
  });
  app.querySelector('#bypass')?.addEventListener('click', () => void withError(async () => { if (rule) await request({ type: 'BYPASS', id: rule.id, minutes: 15 }); await refresh(); toast('已放行 15 分钟，其他规则仍会判断。'); }));
  app.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach(button => button.addEventListener('click', () => void withError(async () => { await request({ type: 'REVOKE_BYPASS', id: button.dataset.revoke! }); await refresh(); toast('临时放行已结束。'); })));
}
async function withError(action: () => Promise<void>): Promise<void> {
  try { await action(); } catch (error) { toast(errorText(error), true); }
}
async function boot(): Promise<void> {
  try {
    const parameter = new URLSearchParams(location.search).get('tabId');
    const requestedId = parameter && /^\d+$/.test(parameter) ? Number(parameter) : undefined;
    const tab = requestedId !== undefined ? await chrome.tabs.get(requestedId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    tabId = tab?.id; currentUrl = tab?.url || '';
    await refresh();
  } catch (error) {
    app.innerHTML = `<div class="fatal-error"><h1>暂时无法读取网页状态</h1><p>${e(errorText(error))}</p><button type="button" class="button primary" id="retry">重试</button></div>`;
    app.querySelector('#retry')!.addEventListener('click', () => void boot());
  }
}
void boot();
