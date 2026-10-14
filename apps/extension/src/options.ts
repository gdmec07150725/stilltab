import type { Config, Matcher, Rule, Snapshot } from './core/types';
import { makeRule, templates } from './core/defaults';
import { MAX_CONFIG_BYTES } from './core/engine';
import { actionLabels, confirmAction, dateKey, days, displayUrl, duration, errorText, escape as e, kindLabels, modal, normalizeUrl, request, scheduleSummary, toast } from './ui';

let state: Snapshot;
let section = 'rules';
const app = document.querySelector<HTMLDivElement>('#app')!;

function render(): void {
  const active = state.config.rules.filter(rule => rule.enabled).length;
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#rules"><img class="brand-mark" src="icons/icon48.png" alt=""><span>停一下<small>网页行为规则</small></span></a><nav aria-label="主导航">${[['rules', '我的规则', '01'], ['templates', '规则模板', '02'], ['logs', '触发记录', '03'], ['settings', '设置与备份', '04']].map(([id, label, num]) => `<button type="button" data-nav="${id}" class="nav-item ${section === id ? 'selected' : ''}" ${section === id ? 'aria-current="page"' : ''}><span class="nav-number">${num}</span>${label}${id === 'rules' ? `<span class="nav-count">${state.config.rules.length}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-note"><span class="local-indicator"></span> 只保存在这台设备上<p>不需要账号，不上传浏览记录。</p></div></aside><main id="main" class="main"><header class="page-header"><div><div class="eyebrow">YOUR BROWSING, YOUR RULES</div><h1>${({ rules: '把注意力，留给想做的事', templates: '从一个小改变开始', logs: '看看规则何时起了作用', settings: '让规则安心留在本地' } as Record<string, string>)[section]}</h1><p>${({ rules: '选择一个网站，设定你的节奏。提醒、等一等，或暂时停下。', templates: '选一个适合自己的模板，填入网站，再决定是否启用。', logs: '记录规则的触发与临时放行，帮助你了解自己的浏览习惯。', settings: '备份配置、迁移到另一台设备，或了解规则如何运行。' } as Record<string, string>)[section]}</p></div>${section === 'rules' ? '<button class="button primary" data-command="new">＋ 新建规则</button>' : ''}</header><div id="content">${section === 'rules' ? rulesView(active) : section === 'templates' ? templatesView() : section === 'logs' ? logsView() : settingsView()}</div><footer class="page-footer">停一下 · 网页行为规则 <span>让每次打开，都更有意识。</span></footer></main></div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(button => button.addEventListener('click', () => { section = button.dataset.nav!; history.replaceState(null, '', `#${section}`); render(); }));
  app.querySelector('.brand')!.addEventListener('click', () => { section = 'rules'; render(); });
  app.querySelectorAll<HTMLElement>('[data-command]').forEach(button => button.addEventListener('click', () => { void command(button.dataset.command!, button.dataset.id); }));
  app.querySelectorAll<HTMLInputElement>('[data-toggle]').forEach(input => input.addEventListener('change', async () => {
    input.disabled = true;
    try { state = await request({ type: 'TOGGLE_RULE', id: input.dataset.toggle!, enabled: input.checked }); render(); toast(input.checked ? '规则已启用，打开的网页也会立即更新。' : '规则已停用。'); }
    catch (error) { input.checked = !input.checked; input.disabled = false; toast(errorText(error), true); }
  }));
  const file = app.querySelector<HTMLInputElement>('#import-file');
  file?.addEventListener('change', () => { if (file.files?.[0]) void reviewImport(file.files[0]); file.value = ''; });
}

function rulesView(active: number): string {
  return `<div class="overview"><div><span class="stat-number">${active}<span> / ${state.config.rules.length}</span></span><span class="stat-label">启用中的规则</span></div><div><span class="stat-number">${state.logs.filter(log => dateKey(log.at) === dateKey(state.now) && log.action !== 'bypass').length}</span><span class="stat-label">今天的规则触发</span></div><div class="overview-note"><span class="tiny-label">从容一点，专注一点</span><p>规则只在你设定的条件下生效。<br>随时停用，也可以临时放行 15 分钟。</p></div></div><div class="section-heading"><h2>我的规则 <span>${state.config.rules.length}</span></h2><button type="button" class="text-button" data-command="templates">浏览常用模板 →</button></div>${state.config.rules.length ? `<div class="rule-list">${state.config.rules.map(rule => ruleCard(rule)).join('')}</div><p class="help-text list-footnote">多条规则同时满足时，依次优先：拦截、等待、提醒；同类再比较高级设置中的优先级。每条规则独立累计用时。</p>` : `<div class="empty-state"><div class="empty-mark" aria-hidden="true">＋</div><h2>第一条规则，从这里开始</h2><p>还没有任何规则在影响你的浏览。<br>可以为常逛的网站设个提醒，也可以先试试模板。</p><div class="button-row"><button type="button" class="button primary" data-command="new">创建第一条规则</button><button type="button" class="button" data-command="templates">看看规则模板</button></div><div class="empty-example"><span>例如</span> 每个工作日，在视频网站浏览满 20 分钟后，提醒我休息一下。</div></div>`}`;
}
function ruleCard(rule: Rule): string {
  const used = (state.usage[dateKey(state.now)] || {})[rule.id] || 0;
  const grant = state.grants.find(item => item.ruleId === rule.id && item.expiresAt > state.now);
  return `<article class="rule-card ${!rule.enabled ? 'disabled-rule' : ''}"><div class="rule-card-main"><span class="action-mark ${rule.action}" aria-hidden="true">${rule.action === 'remind' ? '提' : rule.action === 'delay' ? '等' : '停'}</span><div class="rule-info"><div class="rule-title-row"><h3>${e(rule.name)}</h3><span class="badge ${rule.enabled ? 'active' : ''}">${rule.enabled ? '已启用' : '已停用'}</span>${grant ? '<span class="badge amber">临时放行中</span>' : ''}</div><p class="rule-address" title="${e(rule.match.value)}">${e(kindLabels[rule.match.kind])} · ${e(displayUrl(rule.match.value))}</p><p class="rule-description">${e(scheduleSummary(rule))}${rule.quotaMinutes ? ` · 每日 ${rule.quotaMinutes} 分钟后` : ''} · ${actionLabels[rule.action]}${rule.action === 'delay' ? ` ${rule.delaySeconds} 秒` : ''}</p></div><label class="switch" title="${rule.enabled ? '停用' : '启用'} ${e(rule.name)}"><input type="checkbox" data-toggle="${e(rule.id)}" ${rule.enabled ? 'checked' : ''} aria-label="启用 ${e(rule.name)}"><span></span></label></div><div class="rule-card-bottom"><div class="usage-line">${rule.quotaMinutes ? `<span>今日已用 <strong>${duration(used)}</strong> / ${rule.quotaMinutes} 分钟</span>` : '<span>不限每日额度</span>'}${rule.exceptions.length ? `<span>· ${rule.exceptions.length} 条例外</span>` : ''}${grant ? `<span class="grant-note">放行至 ${new Date(grant.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div><div class="rule-actions"><button class="text-button" data-command="edit" data-id="${e(rule.id)}">编辑</button><button class="text-button" data-command="${grant ? 'revoke' : 'bypass'}" data-id="${e(rule.id)}" ${!rule.enabled ? 'disabled' : ''}>${grant ? '结束放行' : '放行 15 分钟'}</button><button class="text-button muted" data-command="delete" data-id="${e(rule.id)}">删除</button></div></div></article>`;
}
function templatesView(): string {
  return `<div class="info-strip">模板只会填好表单。你确认保存后，规则才会开始工作。</div><div class="template-list">${templates.map((template, index) => `<article class="template-card"><span class="template-number">0${index + 1}</span><div><h2>${e(template.title)}</h2><p>${e(template.description)}</p></div><button type="button" class="button" data-command="template" data-id="${e(template.id)}">使用模板 →</button></article>`).join('')}</div><div class="quiet-panel"><h3>不确定从哪里开始？</h3><p>先选择「仅提醒」，保留自由浏览的余地。找到适合自己的节奏后，再尝试等待或拦截。</p></div>`;
}
function logsView(): string {
  return `<div class="section-heading"><div><h2>最近的触发记录 <span>${state.logs.length}</span></h2><p class="help-text">仅存于本机；最多保留最近 300 条。重复评估不会反复写入同一触发。</p></div><div class="button-row"><button type="button" class="button" data-command="refresh">刷新</button><button type="button" class="button" data-command="clear-logs" ${!state.logs.length ? 'disabled' : ''}>清空记录</button></div></div>${state.logs.length ? `<div class="log-list">${[...state.logs].sort((a, b) => b.at - a.at).map(log => `<article class="log-row"><div class="log-date">${new Date(log.at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}<span>${new Date(log.at).toLocaleTimeString('zh-CN', { hour12: false })}</span></div><div class="log-main"><h3>${e(log.ruleName)} <span class="badge">${log.action === 'bypass' ? '临时放行' : actionLabels[log.action]}</span></h3><p class="log-url" title="${e(log.url)}">${e(log.url || '所有匹配页面')}</p><p>${e(log.detail)}</p></div></article>`).join('')}</div>` : '<div class="empty-state compact"><div class="empty-mark">✓</div><h2>这里还很安静</h2><p>规则触发后，你会在这里看到时间、网页和处理结果。</p></div>'}`;
}
function settingsView(): string {
  return `<section class="settings-panel"><div class="section-heading"><div><h2>配置备份</h2><p>导出的是规则设置，不包含浏览记录、每日用时或临时放行。</p></div><span class="badge active">本地保存</span></div><div class="button-row"><button type="button" class="button primary" data-command="export">导出配置 JSON</button><button type="button" class="button" data-command="import">导入配置</button><input type="file" id="import-file" accept=".json,application/json" hidden></div><p class="help-text">导入会先显示预览，确认后替换全部规则，并重置用时和放行状态。建议先导出一份备份。</p></section><section class="settings-panel"><h2>规则如何运行</h2><dl class="explanation-list"><div><dt>匹配与例外</dt><dd>网站匹配域名；路径匹配该路径及下级路径；具体页面匹配完整地址。每条例外只跳过其所属规则，其他规则仍可能生效。</dd></div><div><dt>时段与每日额度</dt><dd>只有所选时段内且当日额度已用完，才执行处理；额度为 0 代表不设额度门槛。每日用时只累计该规则所选时段内，匹配页面的前台浏览时间，按本机日期零点归零。</dd></div><div><dt>跨午夜时段</dt><dd>22:00–07:00 归属于开始的那一天。例如周五的时段会延续至周六 07:00；开始与结束相同代表所选日全天，结束时刻不包含。</dd></div><div><dt>冲突时谁生效</dt><dd>先比较处理方式：拦截 &gt; 等待 &gt; 提醒；再比较优先级，大的优先；仍相同时，较早创建的规则优先。规则列表的顺序不会改变此行为。</dd></div><div><dt>等待、确认与临时放行</dt><dd>确认提醒或完成等待，仅放行当前标签页的当前地址；刷新保留，离开该地址或重启浏览器后失效。临时放行持续 15 分钟，对该规则的所有页面生效，重启后保留至到期，其他规则继续判断。</dd></div><div><dt>如何计算用时</dt><dd>只计算前台浏览器窗口中的活动页面；等待和拦截期间不计时。临时放行期间仍计时。服务后台休眠或浏览器关闭后，不补计无法确定的离线时间。</dd></div></dl></section><section class="settings-panel"><h2>使用范围</h2><p>支持桌面 Chrome、Edge 的 HTTP / HTTPS 网页。浏览器设置页、扩展商店和其他受保护页面无法执行规则。首次安装没有启用的示例规则。</p><p class="help-text">这是帮助自我管理的工具。网页内容可能先于提示出现；关闭或移除扩展即可停止限制。规则、匹配网址及最近触发记录只保存在本机扩展存储中。</p></section>`;
}

async function command(name: string, id?: string): Promise<void> {
  try {
    if (name === 'new') return openEditor();
    if (name === 'templates') { section = 'templates'; render(); return; }
    if (name === 'template') { const template = templates.find(item => item.id === id); if (template) openEditor(template.create(), true); return; }
    const rule = state.config.rules.find(item => item.id === id);
    if (name === 'edit' && rule) return openEditor(rule);
    if (name === 'delete' && rule) { if (!await confirmAction('删除这条规则？', `「${rule.name}」及其用时、放行状态将被移除。此操作无法撤销。`, '删除规则')) return; state = await request({ type: 'DELETE_RULE', id: rule.id }); toast('规则已删除。'); }
    if (name === 'bypass' && rule) { state = await request({ type: 'BYPASS', id: rule.id, minutes: 15 }); toast(`「${rule.name}」已临时放行 15 分钟，其他规则仍然生效。`); }
    if (name === 'revoke' && rule) { state = await request({ type: 'REVOKE_BYPASS', id: rule.id }); toast('临时放行已结束。'); }
    if (name === 'refresh') state = await request({ type: 'GET_STATE' });
    if (name === 'clear-logs') { if (!await confirmAction('清空触发记录？', '所有本地触发记录将被移除。规则和每日用时不受影响。', '清空记录')) return; state = await request({ type: 'CLEAR_LOGS' }); toast('触发记录已清空。'); }
    if (name === 'export') {
      state = await request({ type: 'GET_STATE' });
      const url = URL.createObjectURL(new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `停一下-网页行为规则-${dateKey()}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); toast('配置已导出，不含记录与用时。'); return;
    }
    if (name === 'import') { app.querySelector<HTMLInputElement>('#import-file')!.click(); return; }
    render();
  } catch (error) { toast(errorText(error), true); }
}

async function reviewImport(file: File): Promise<void> {
  try {
    if (file.size > MAX_CONFIG_BYTES) throw new Error('文件过大，请选择不超过 2 MB 的规则配置。');
    const config: unknown = JSON.parse(await file.text());
    if (!config || typeof config !== 'object' || (config as Config).version !== 1 || !Array.isArray((config as Config).rules)) throw new Error('这不是有效的第 1 版规则配置。');
    const rules = (config as Config).rules;
    if (rules.length > 200) throw new Error('一次最多导入 200 条规则。');
    if (rules.some(rule => !rule || typeof rule !== 'object' || typeof rule.name !== 'string' || !rule.match || typeof rule.match.value !== 'string')) throw new Error('配置中的规则格式不完整，原配置未被更改。');
    const dialog = modal('检查要导入的规则', `<div class="dialog-body"><div class="warning-strip">确认后将替换当前 ${state.config.rules.length} 条规则，重置每日用时和放行状态。导入中的已启用规则会立即影响打开的网页。</div><p>文件：${e(file.name)}<br>共 ${rules.length} 条，${rules.filter(rule => rule.enabled).length} 条启用。</p><ul class="import-list">${rules.map(rule => `<li><strong>${e(rule.name)}</strong><span>${e(rule.match.value)}</span><small>${rule.enabled ? '已启用' : '已停用'}</small></li>`).join('')}</ul><p class="form-error" id="import-error" role="alert"></p></div><div class="dialog-footer"><button type="button" class="button cancel">取消</button><button type="button" class="button danger confirm-import">替换全部规则</button></div>`, 'small-dialog');
    dialog.querySelector('.cancel')!.addEventListener('click', () => dialog.close());
    dialog.querySelector<HTMLButtonElement>('.confirm-import')!.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = '正在校验并导入…';
      try { state = await request({ type: 'IMPORT_CONFIG', config }); dialog.close(); section = 'rules'; render(); toast(`已导入 ${rules.length} 条规则。`); }
      catch (error) { dialog.querySelector('#import-error')!.textContent = errorText(error); button.disabled = false; button.textContent = '替换全部规则'; }
    });
  } catch (error) { toast(errorText(error), true); }
}

function openEditor(existing?: Rule, isTemplate = false, scope?: Matcher['kind']): void {
  const isNew = !existing || isTemplate || !state.config.rules.some(rule => rule.id === existing.id);
  const rule = structuredClone(existing || makeRule());
  if (!existing || isTemplate) { rule.match.value = ""; if (!existing) rule.name = ""; }
  if (scope) rule.match.kind = scope;
  const exceptions = [...rule.exceptions];
  const dialog = modal(isNew ? '创建一条自己的规则' : '编辑规则', `<form id="rule-form"><div class="editor-layout"><div class="editor-fields"><label class="field-label" for="rule-name">规则名称</label><input id="rule-name" name="name" required maxlength="80" placeholder="例如：工作时少刷一会儿" value="${e(rule.name)}"><section class="form-section"><div class="step-heading"><span>1</span><h3>当我打开</h3></div><fieldset class="choice-group scope-choice"><legend class="sr-only">匹配范围</legend>${(['site', 'path', 'page'] as const).map(kind => `<label><input type="radio" name="kind" value="${kind}" ${rule.match.kind === kind ? 'checked' : ''}><span>${kindLabels[kind]}</span></label>`).join('')}</fieldset><label class="field-label" for="rule-url">网站或网页地址</label><input id="rule-url" name="url" type="text" inputmode="url" required maxlength="4096" placeholder="例如：example.com 或粘贴网页地址" value="${e(rule.match.value)}"><p class="help-text" id="match-help"></p></section><section class="form-section"><div class="step-heading"><span>2</span><h3>在这些时候</h3></div><label class="checkbox-label"><input type="checkbox" id="schedule-enabled" ${rule.schedule.enabled ? 'checked' : ''}> 只在指定日期和时段生效</label><div id="schedule-fields" ${rule.schedule.enabled ? '' : 'hidden'}><div class="day-preset"><button class="text-button" type="button" data-days="work">工作日</button><button class="text-button" type="button" data-days="all">每天</button><button class="text-button" type="button" data-days="weekend">周末</button></div><fieldset class="day-choice"><legend class="sr-only">生效日期</legend>${[1, 2, 3, 4, 5, 6, 0].map(day => `<label><input type="checkbox" name="days" value="${day}" ${rule.schedule.days.includes(day) ? 'checked' : ''}><span>周${days[day]}</span></label>`).join('')}</fieldset><div class="time-row"><label>从 <input type="time" id="start-time" value="${e(rule.schedule.start)}" required></label><span>到</span><label><span class="sr-only">结束时间</span><input type="time" id="end-time" value="${e(rule.schedule.end)}" required></label></div><p class="help-text" id="time-help"></p></div><div class="quota-field"><label class="checkbox-label"><input type="checkbox" id="quota-enabled" ${rule.quotaMinutes > 0 ? 'checked' : ''}> 每日浏览满额度后才处理</label><div id="quota-fields" ${rule.quotaMinutes > 0 ? '' : 'hidden'}><label class="inline-label">每天 <input class="number-input" type="number" id="quota-minutes" min="1" max="1440" step="1" value="${rule.quotaMinutes || 20}" required> 分钟</label><p class="help-text">只算设定时段内的前台浏览；当天所有匹配页面合计。</p></div></div></section><section class="form-section"><div class="step-heading"><span>3</span><h3>帮我</h3></div><fieldset class="action-choice"><legend class="sr-only">处理方式</legend>${(['remind', 'delay', 'block'] as const).map(action => `<label><input type="radio" name="action" value="${action}" ${rule.action === action ? 'checked' : ''}><span><strong>${actionLabels[action]}</strong><small>${action === 'remind' ? '轻轻提醒，仍可继续' : action === 'delay' ? '停一会儿，再决定' : '暂时停止访问'}</small></span></label>`).join('')}</fieldset><div id="delay-fields" ${rule.action === 'delay' ? '' : 'hidden'}><label class="inline-label">等待 <input class="number-input" type="number" id="delay-seconds" min="1" max="3600" step="1" value="${rule.delaySeconds}" required> 秒后允许继续</label><p class="help-text">切到后台也会继续倒计时。放行只限当前标签页的当前地址。</p></div><label class="field-label" for="rule-message">对自己说的话</label><textarea id="rule-message" name="message" rows="3" maxlength="1000" required>${e(rule.message)}</textarea><label class="field-label" for="button-text">按钮文字</label><input id="button-text" name="buttonText" maxlength="40" required value="${e(rule.buttonText)}"><p class="help-text" id="button-help"></p></section><details class="advanced"><summary>高级设置 <span>例外链接、匹配细节与优先级</span></summary><div class="advanced-body"><label class="checkbox-label"><input type="checkbox" id="include-subdomains" ${rule.match.includeSubdomains ? 'checked' : ''}> 包含子域名（例如 www.example.com）</label><div id="page-match-options"><label class="checkbox-label"><input type="checkbox" id="ignore-query" ${rule.match.ignoreQuery ? 'checked' : ''}> 忽略问号后的查询参数</label><label class="checkbox-label"><input type="checkbox" id="ignore-hash" ${rule.match.ignoreHash ? 'checked' : ''}> 忽略 # 后的片段</label></div><p class="help-text">网站与路径默认忽略协议、端口、查询参数和片段。具体页面保留协议、端口及路径末尾斜杠。</p><h4>例外链接</h4><p class="help-text">遇到这些链接时跳过本规则，其他规则仍可能生效。</p><div id="exceptions"></div><div class="exception-add"><label><span class="sr-only">例外范围</span><select id="exception-kind"><option value="page">具体页面</option><option value="path">网址路径</option><option value="site">整个网站</option></select></label><label class="grow"><span class="sr-only">例外地址</span><input id="exception-url" placeholder="粘贴要排除的链接" maxlength="4096"></label><button class="button" type="button" id="add-exception">添加</button></div><p id="exception-error" class="form-error" role="alert"></p><label class="field-label" for="priority">同类处理的优先级</label><input type="number" class="number-input" id="priority" min="-1000" max="1000" step="1" value="${rule.priority}" required><p class="help-text">默认 0。相同处理方式下，数字越大越优先；跨处理方式始终先拦截，再等待，再提醒。</p></div></details><label class="checkbox-label enable-on-save"><input id="rule-enabled" type="checkbox" ${rule.enabled ? 'checked' : ''}> 保存后启用这条规则</label><p class="form-error" id="save-error" role="alert"></p></div><aside class="editor-preview"><div class="tiny-label">这条规则的意思是</div><p class="sentence-preview" id="sentence-preview"></p><div class="preview-title">效果预览 <span>仅为示意，不会操作网页</span></div><div class="effect-preview" id="effect-preview"></div><p class="help-text">生效时会明确显示规则名称。可以从扩展弹窗或设置页临时放行。</p></aside></div><div class="dialog-footer sticky-footer"><span class="help-text">保存后会立即更新已打开的网页</span><button type="button" class="button cancel">取消</button><button type="submit" class="button primary" id="save-rule">保存规则</button></div></form>`, 'editor-dialog');
  const form = dialog.querySelector<HTMLFormElement>('#rule-form')!;
  const input = <T extends HTMLElement = HTMLInputElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  const value = (id: string) => input<HTMLInputElement>(id).value;
  const checked = (id: string) => input<HTMLInputElement>(id).checked;
  const kind = () => (form.elements.namedItem('kind') as RadioNodeList).value as Matcher['kind'];
  const action = () => (form.elements.namedItem('action') as RadioNodeList).value as Rule['action'];
  function collect(validate = true): Rule {
    const url = validate ? normalizeUrl(value('rule-url')) : value('rule-url');
    const result: Rule = { ...rule, name: value('rule-name').trim(), enabled: checked('rule-enabled'), match: { kind: kind(), value: url, includeSubdomains: checked('include-subdomains'), ignoreQuery: checked('ignore-query'), ignoreHash: checked('ignore-hash') }, exceptions, schedule: { enabled: checked('schedule-enabled'), days: [...form.querySelectorAll<HTMLInputElement>('input[name="days"]:checked')].map(item => Number(item.value)), start: value('start-time') || rule.schedule.start, end: value('end-time') || rule.schedule.end }, quotaMinutes: checked('quota-enabled') ? Number(value('quota-minutes')) : 0, action: action(), delaySeconds: action() === 'delay' ? Number(value('delay-seconds')) : rule.delaySeconds, message: value('rule-message').trim(), buttonText: value('button-text').trim(), priority: Number(value('priority')) };
    if (validate && result.schedule.enabled && !result.schedule.days.length) throw new Error('请至少选择一个生效日期。');
    if (validate && value('exception-url').trim()) throw new Error('例外地址尚未添加。请点击「添加」或清空该地址后保存。');
    return result;
  }
  function preview(): void {
    const draft = collect(false);
    input('match-help').textContent = draft.match.kind === 'site' ? '该网站的全部页面都匹配。子域名可在高级设置中调整。' : draft.match.kind === 'path' ? '匹配该路径及下级路径，例如 /video 也匹配 /video/123，但不匹配 /videos。' : '只匹配这个具体网页。查询参数和 # 片段可在高级设置中调整。';
    input('time-help').textContent = draft.schedule.start === draft.schedule.end ? '开始与结束相同，表示所选日全天。' : draft.schedule.start > draft.schedule.end ? '跨午夜时段归开始日；例如周五 22:00 延续至周六 07:00。' : '按本机时间判断，包含开始时刻，不包含结束时刻。';
    input('schedule-fields').hidden = !draft.schedule.enabled;
    input<HTMLInputElement>('start-time').disabled = !draft.schedule.enabled;
    input<HTMLInputElement>('end-time').disabled = !draft.schedule.enabled;
    input('quota-fields').hidden = !checked('quota-enabled');
    input<HTMLInputElement>('quota-minutes').disabled = !checked('quota-enabled');
    input('delay-fields').hidden = draft.action !== 'delay';
    input<HTMLInputElement>('delay-seconds').disabled = draft.action !== 'delay';
    input('page-match-options').hidden = draft.match.kind !== 'page';
    input('button-help').textContent = draft.action === 'block' ? '这个按钮会关闭当前网页标签，不会放行。' : draft.action === 'delay' ? '倒计时结束后，这个按钮允许继续浏览当前地址。' : '这个按钮收起提醒，并放行当前标签页的当前地址。';
    const address = draft.match.value ? displayUrl(draft.match.value) : '你选的网站';
    input('sentence-preview').textContent = `${scheduleSummary(draft)}，当我打开${kindLabels[draft.match.kind]}「${address}」${draft.quotaMinutes ? `，每天浏览满 ${draft.quotaMinutes} 分钟后` : ''}，${draft.action === 'remind' ? '提醒我停下来想一想。' : draft.action === 'delay' ? `让我等 ${draft.delaySeconds || 1} 秒再继续。` : '帮我拦截这个网页。'}`;
    input('effect-preview').innerHTML = `<div class="preview-rule-label">正在生效 · ${e(draft.name || '未命名规则')}</div><div class="preview-symbol ${draft.action}">${draft.action === 'remind' ? '提' : draft.action === 'delay' ? '等' : '停'}</div><h3>${draft.action === 'remind' ? '给自己一个小提醒' : draft.action === 'delay' ? '先停一会儿' : '把注意力放回重要的事'}</h3><p class="preview-message">${e(draft.message || '你写下的提示语会显示在这里。')}</p>${draft.action === 'delay' ? `<div class="preview-countdown">${draft.delaySeconds || 1}<span>秒后可以继续</span></div>` : ''}<button type="button" class="button primary preview-button" tabindex="-1" aria-disabled="true">${e(draft.buttonText || '按钮文字')}</button><small>停一下 · 管理规则</small>`;
  }
  function renderExceptions(): void {
    input('exceptions').innerHTML = exceptions.map((exception, index) => `<div class="exception-row"><div><strong>${kindLabels[exception.kind]}</strong><span>${e(exception.value)}</span><small>${exception.includeSubdomains ? '含子域名' : '仅此域名'}${exception.kind === 'page' ? ` · ${exception.ignoreQuery ? '忽略' : '保留'}查询参数 · ${exception.ignoreHash ? '忽略' : '保留'}片段` : ''}</small></div><button class="icon-button" type="button" data-remove="${index}" aria-label="移除例外 ${e(exception.value)}">×</button></div>`).join('');
    input('exceptions').querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button => button.addEventListener('click', () => { exceptions.splice(Number(button.dataset.remove), 1); renderExceptions(); }));
  }
  input('add-exception').addEventListener('click', () => {
    try { const url = normalizeUrl(value('exception-url')); exceptions.push({ kind: input<HTMLSelectElement>('exception-kind').value as Matcher['kind'], value: url, includeSubdomains: false, ignoreQuery: false, ignoreHash: true }); input<HTMLInputElement>('exception-url').value = ''; input('exception-error').textContent = ''; renderExceptions(); }
    catch (error) { input('exception-error').textContent = errorText(error); }
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-days]').forEach(button => button.addEventListener('click', () => {
    const picked = button.dataset.days === 'all' ? [0, 1, 2, 3, 4, 5, 6] : button.dataset.days === 'work' ? [1, 2, 3, 4, 5] : [0, 6];
    form.querySelectorAll<HTMLInputElement>('input[name="days"]').forEach(item => item.checked = picked.includes(Number(item.value))); preview();
  }));
  form.querySelectorAll<HTMLInputElement>('input[name="action"]').forEach(item => item.addEventListener('change', () => {
    const text = input<HTMLInputElement>('button-text');
    text.value = action() === 'block' ? '离开此页' : action() === 'delay' ? '继续浏览' : '知道了';
    preview();
  }));
  form.addEventListener('input', preview); form.addEventListener('change', preview);
  dialog.querySelector('.cancel')!.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = input<HTMLButtonElement>('save-rule');
    try { const draft = collect(); button.disabled = true; button.textContent = '正在保存…'; input('save-error').textContent = ''; state = await request({ type: 'SAVE_RULE', rule: draft }); dialog.close(); section = 'rules'; render(); toast(draft.enabled ? '规则已保存并启用。' : '规则已保存，当前处于停用状态。'); }
    catch (error) { input('save-error').textContent = errorText(error); input('save-error').scrollIntoView({ block: 'nearest' }); button.disabled = false; button.textContent = '保存规则'; }
  });
  renderExceptions(); preview();
  input('rule-name').focus();
}

async function boot(): Promise<void> {
  try {
    state = await request({ type: 'GET_STATE' });
    const selected = location.hash.slice(1);
    if (['rules', 'templates', 'logs', 'settings'].includes(selected)) section = selected;
    render();
    const params = new URLSearchParams(location.search);
    const url = params.get('url');
    if (url) { const normalized = normalizeUrl(url); const draft = makeRule(normalized); draft.match.value = normalized; draft.enabled = true; const scope = params.get('scope'); openEditor(draft, false, ['site', 'path', 'page'].includes(scope || '') ? scope as Matcher['kind'] : 'site'); history.replaceState(null, '', location.pathname); }
  } catch (error) { app.innerHTML = `<div class="fatal-error"><h1>暂时无法读取规则</h1><p>${e(errorText(error))}</p><button type="button" class="button primary" id="retry">重新读取</button></div>`; app.querySelector('#retry')?.addEventListener('click', () => void boot()); }
}
window.addEventListener('focus', () => {
  if (state && !document.querySelector('dialog[open]')) void request({ type: 'GET_STATE' }).then(next => { state = next; render(); }).catch(error => toast(errorText(error), true));
});
void boot();
