import type { Rule } from './types';

/** Blank installations contain no rules; call this only after a user chooses to create one. */
export function makeRule(value = 'https://example.com'): Rule {
  let url: URL;
  try { url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsupported'); }
  catch { url = new URL('https://example.com'); }
  const id = globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  return {
    id, name: `${url.hostname} 浏览提醒`.slice(0, 80), enabled: true,
    match: { kind: 'site', value: url.origin, includeSubdomains: true, ignoreQuery: false, ignoreHash: true },
    exceptions: [], schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
    quotaMinutes: 0, action: 'remind', delaySeconds: 15,
    message: '这是你想把时间花在的地方吗？停一下，再做决定。', buttonText: '想好了，继续浏览', priority: 0, createdAt: Date.now(),
  };
}
export const templates: { id: string; title: string; description: string; create: (url?: string) => Rule }[] = [
  { id: 'focus', title: '工作时段，保持专注', description: '工作日 09:00–18:00 拦截分心网站，可添加工作链接例外。', create: (url) => {
    const rule = makeRule(url); return { ...rule, name: '工作时段保持专注', action: 'block', schedule: { ...rule.schedule, enabled: true }, message: '现在是专注时间。先把手头的事做好，休息时再来。', buttonText: '关闭当前页面' };
  } },
  { id: 'quota', title: '每天只看半小时', description: '每天可用 30 分钟；用完后提醒，时间只计算前台活动页面。', create: (url) => ({ ...makeRule(url), name: '每天只看半小时', quotaMinutes: 30, message: '今天已看了 30 分钟，给自己安排一点别的事吧。', buttonText: '知道了，继续浏览' }) },
  { id: 'pause', title: '打开之前，等一等', description: '打开网站先等待 15 秒，让每次浏览多一点主动选择。', create: (url) => ({ ...makeRule(url), name: '打开之前等一等', action: 'delay', message: '深呼吸，想想这次打开网页是为了什么。', buttonText: '我想好了，继续' }) },
  { id: 'night', title: '夜深了，早点休息', description: '每天 23:00 到次日 07:00 提醒休息；跨午夜归开始日。', create: (url) => ({ ...makeRule(url), name: '夜深了早点休息', schedule: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '07:00' }, message: '今天已经很充实了。放下网页，好好睡一觉。', buttonText: '知道了，再看一会' }) },
];
