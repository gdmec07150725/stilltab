import type { Action, Matcher, Request, Response, Rule, Snapshot } from './core/types';

export function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
export async function request(message: Request): Promise<Snapshot> {
  const response: Response<Snapshot> = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) throw new Error(response && !response.ok ? response.error : '扩展暂时没有响应，请稍后重试。');
  return response.data;
}
export function toast(message: string, error = false): void {
  const region = document.querySelector<HTMLElement>('#toast');
  if (!region) return;
  region.textContent = message;
  region.className = `toast visible${error ? ' error' : ''}`;
  window.setTimeout(() => region.classList.remove('visible'), error ? 8000 : 3500);
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export const actionLabels: Record<Action, string> = { remind: '仅提醒', delay: '等待后放行', block: '直接拦截' };
export const kindLabels: Record<Matcher['kind'], string> = { site: '整个网站', path: '网址路径', page: '具体页面' };
export const days = ['日', '一', '二', '三', '四', '五', '六'];
export function duration(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)} 秒`;
  return `${Math.floor(ms / 60000)} 分 ${Math.floor(ms % 60000 / 1000)} 秒`;
}
export function dateKey(now = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function scheduleSummary(rule: Rule): string {
  if (!rule.schedule.enabled) return '每天，全天';
  const chosen = rule.schedule.days;
  const label = chosen.length === 7 ? '每天' : chosen.length === 5 && [1, 2, 3, 4, 5].every(n => chosen.includes(n)) ? '工作日' : chosen.map(n => `周${days[n]}`).join('、');
  return `${label}，${rule.schedule.start === rule.schedule.end ? '全天' : `${rule.schedule.start}–${rule.schedule.end}${rule.schedule.end < rule.schedule.start ? '（次日）' : ''}`}`;
}
export function displayUrl(value: string): string {
  try { const url = new URL(value); return url.host + (url.pathname === '/' ? '' : url.pathname) + url.search + url.hash; }
  catch { return value; }
}
export function normalizeUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error('请先填写网站或网页地址。');
  const bareHostPort = /^(?:[^\s/?#:@]+|\[[a-f\d:.]+\]):\d{1,5}(?:[/?#]|$)/i.test(raw);
  let url: URL;
  try { url = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw) && !bareHostPort ? raw : `https://${raw}`); }
  catch { throw new Error('网页地址格式不正确，请填写域名或完整链接。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('请填写有效的 HTTP 或 HTTPS 网页地址，不要包含账号或密码。');
  return url.href;
}
export function modal(title: string, body: string, className = ''): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = `dialog ${className}`;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${escape(title)}</h2><button type="button" class="icon-button dialog-close" aria-label="关闭">×</button></div>${body}`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  document.body.append(dialog);
  dialog.querySelector('.dialog-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
  return dialog;
}
export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise(resolve => {
    let confirmed = false;
    const dialog = modal(title, `<div class="dialog-body"><p>${escape(message)}</p></div><div class="dialog-footer"><button class="button cancel" type="button">取消</button><button class="button danger confirm" type="button">${escape(confirmLabel)}</button></div>`, 'small-dialog');
    dialog.querySelector('.cancel')!.addEventListener('click', () => dialog.close());
    dialog.querySelector('.confirm')!.addEventListener('click', () => { confirmed = true; dialog.close(); });
    dialog.addEventListener('close', () => resolve(confirmed), { once: true });
    (dialog.querySelector('.cancel') as HTMLButtonElement).focus();
  });
}
