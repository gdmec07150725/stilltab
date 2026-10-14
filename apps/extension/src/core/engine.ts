import type { Action, Config, Decision, Grant, Matcher, Rule, Schedule, Usage } from './types';

export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

const ACTION_WEIGHT: Record<Action, number> = { remind: 1, delay: 2, block: 3 };
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function parseUrl(value: string, allowBareHost = false): URL | null {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f]/.test(value.trim())) return null;
  try {
    const bareHostPort = /^(?:[^\s/?#:@]+|\[[a-f\d:.]+\]):\d{1,5}(?:[/?#]|$)/i.test(value);
    const candidate = allowBareHost && (!/^[a-z][a-z\d+.-]*:/i.test(value) || bareHostPort) ? `https://${value.trim()}` : value.trim();
    const url = new URL(candidate);
    return HTTP_PROTOCOLS.has(url.protocol) && !!url.hostname && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function hostname(url: URL): string { return url.hostname.toLowerCase().replace(/\.$/, ''); }
function normalizedPath(url: URL): string {
  return url.pathname.replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
    const value = String.fromCharCode(parseInt(hex, 16));
    return /^[A-Za-z0-9._~-]$/.test(value) ? value : escape.toUpperCase();
  });
}

/** Site/path use host + path; exact pages additionally keep scheme, port, query/hash. */
export function matchesUrl(value: string, matcher: Matcher): boolean {
  const url = parseUrl(value);
  const target = matcher && parseUrl(matcher.value, true);
  if (!url || !target) return false;
  const host = hostname(url); const wanted = hostname(target);
  if (host !== wanted && !(matcher.includeSubdomains && host.endsWith(`.${wanted}`))) return false;
  if (matcher.kind === 'site') return true;
  const path = normalizedPath(url); const targetPath = normalizedPath(target);
  if (matcher.kind === 'path') {
    const base = targetPath.replace(/\/+$/, '') || '/';
    return base === '/' || path === base || path.startsWith(`${base}/`);
  }
  if (matcher.kind !== 'page') return false;
  return url.protocol === target.protocol && url.port === target.port && path === targetPath
    && (matcher.ignoreQuery || url.search === target.search)
    && (matcher.ignoreHash || url.hash === target.hash);
}

export function matchesRule(url: string, rule: Rule): boolean {
  return rule.enabled && matchesUrl(url, rule.match) && !rule.exceptions.some((matcher) => matchesUrl(url, matcher));
}
function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
export function isScheduleActive(schedule: Schedule, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  if (!schedule.enabled) return true;
  const start = minuteOfDay(schedule.start); const end = minuteOfDay(schedule.end);
  const current = now.getHours() * 60 + now.getMinutes(); const day = now.getDay();
  if (start === end) return schedule.days.includes(day);
  if (start < end) return schedule.days.includes(day) && current >= start && current < end;
  return (current >= start && schedule.days.includes(day)) || (current < end && schedule.days.includes((day + 6) % 7));
}
export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function usedToday(usage: Usage, id: string, date: string): number {
  const bucket = Object.hasOwn(usage, date) ? usage[date] : null;
  const value = bucket && typeof bucket === 'object' && Object.hasOwn(bucket, id) ? bucket[id] : 0;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
function compareRules(a: Rule, b: Rule): number {
  return ACTION_WEIGHT[b.action] - ACTION_WEIGHT[a.action] || b.priority - a.priority || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function decide(url: string, rules: Rule[], usage: Usage, grants: Grant[], now: number, ignoredIds: string[] = []): Decision {
  const time = new Date(now); const date = localDateKey(time);
  if (!parseUrl(url) || !Number.isFinite(now)) return { rule: null, matched: [], reason: '此页面不支持规则处理', usedMs: 0 };
  const urlMatched = rules.filter((rule) => matchesRule(url, rule));
  const matched = urlMatched.filter((rule) => isScheduleActive(rule.schedule, time)).sort(compareRules);
  const grantIds = new Set(grants.filter((grant) => grant.expiresAt > now).map((grant) => grant.ruleId));
  const ignored = new Set(ignoredIds);
  const available = matched.filter((rule) => !grantIds.has(rule.id) && !ignored.has(rule.id));
  const active = available.find((rule) => rule.quotaMinutes === 0 || usedToday(usage, rule.id, date) >= rule.quotaMinutes * 60_000);
  if (active) return { rule: active, matched, reason: active.quotaMinutes > 0 ? `“${active.name}”的今日额度已用完` : `“${active.name}”正在生效`, usedMs: usedToday(usage, active.id, date) };
  const representative = available[0] ?? matched[0];
  let reason = '当前页面没有启用的匹配规则';
  if (urlMatched.length && !matched.length) reason = '匹配规则当前不在生效时段';
  else if (matched.length && !available.length) reason = matched.some((rule) => grantIds.has(rule.id)) ? '匹配规则处于临时放行中' : '当前页面已确认放行';
  else if (available.length) reason = '今日使用额度尚未用完';
  return { rule: null, matched, reason, usedMs: representative ? usedToday(usage, representative.id, date) : 0 };
}

/** Caller supplies only verified foreground intervals. Minute slices handle midnight, schedules and DST folds. */
export function accrueUsage(usage: Usage, rules: Rule[], url: string, from: number, to: number): Usage {
  const result: Usage = Object.fromEntries(Object.entries(usage).map(([day, values]) => [day, { ...values }]));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !Number.isFinite(new Date(from).getTime()) || !Number.isFinite(new Date(to).getTime())) return result;
  const eligible = rules.filter((rule) => !RESERVED_IDS.has(rule.id) && matchesRule(url, rule));
  if (!eligible.length) return result;
  let cursor = from;
  while (cursor < to) {
    // All user schedule boundaries have minute precision. Advancing epoch minutes also visits repeated local minutes at DST end.
    const end = Math.min(to, (Math.floor(cursor / 60_000) + 1) * 60_000);
    const local = new Date(cursor); const key = localDateKey(local);
    const counted = new Set<string>();
    for (const rule of eligible) {
      if (!counted.has(rule.id) && isScheduleActive(rule.schedule, local)) {
        if (!Object.hasOwn(result, key)) result[key] = {};
        result[key][rule.id] = usedToday(result, rule.id, key) + end - cursor;
        counted.add(rule.id);
      }
    }
    cursor = end;
  }
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}
function field(source: Record<string, unknown>, key: string): unknown { return Object.hasOwn(source, key) ? source[key] : undefined; }
function string(value: unknown, label: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new Error(`${label}长度须为 ${min}–${max} 个字符`);
  return value.trim();
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须为开启或关闭`);
  return value;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}须为 ${min}–${max} 的整数`);
  return value;
}
function validateMatcher(value: unknown): Matcher {
  const raw = object(value, '匹配设置'); const kind = field(raw, 'kind');
  if (kind !== 'site' && kind !== 'path' && kind !== 'page') throw new Error('匹配方式须为网站、路径或具体页面');
  const text = string(field(raw, 'value'), '匹配网址', 2048);
  const url = parseUrl(text, true);
  if (!url) throw new Error('匹配网址须为有效的 HTTP(S) 网址，且不能含用户名或密码');
  if (url.href.length > 2048) throw new Error('匹配网址经过 URL 编码后不能超过 2048 个字符，请缩短路径或参数');
  return { kind, value: url.href, includeSubdomains: boolean(field(raw, 'includeSubdomains'), '子域名设置'), ignoreQuery: boolean(field(raw, 'ignoreQuery'), '忽略查询参数设置'), ignoreHash: boolean(field(raw, 'ignoreHash'), '忽略锚点设置') };
}
function validateSchedule(value: unknown): Schedule {
  const raw = object(value, '时段设置'); const enabled = boolean(field(raw, 'enabled'), '时段开关'); const days = field(raw, 'days');
  if (!Array.isArray(days) || days.length > 7 || (enabled && !days.length)) throw new Error('启用时段时至少选择一天，一周最多七天');
  const checkedDays = days.map((day) => integer(day, '星期', 0, 6));
  if (new Set(checkedDays).size !== checkedDays.length) throw new Error('星期不能重复');
  const start = field(raw, 'start'); const end = field(raw, 'end');
  for (const time of [start, end]) if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('时间须为 00:00–23:59 格式');
  return { enabled, days: checkedDays, start: start as string, end: end as string };
}

/** Construct whitelisted objects rather than merging untrusted JSON into runtime state. */
export function validateRule(value: unknown): Rule {
  const raw = object(value, '规则'); const id = string(field(raw, 'id'), '规则 ID', 100);
  if (!/^[A-Za-z0-9_-]+$/.test(id) || RESERVED_IDS.has(id)) throw new Error('规则 ID 含有不允许的字符或保留名称');
  const exceptions = field(raw, 'exceptions');
  if (!Array.isArray(exceptions) || exceptions.length > 20) throw new Error('每条规则最多设置 20 个例外网址');
  const action = field(raw, 'action');
  if (action !== 'remind' && action !== 'delay' && action !== 'block') throw new Error('处理方式须为提醒、等待或拦截');
  return {
    id, name: string(field(raw, 'name'), '规则名称', 80), enabled: boolean(field(raw, 'enabled'), '规则开关'),
    match: validateMatcher(field(raw, 'match')), exceptions: exceptions.map(validateMatcher), schedule: validateSchedule(field(raw, 'schedule')),
    quotaMinutes: integer(field(raw, 'quotaMinutes'), '每日额度（分钟）', 0, 1440), action,
    delaySeconds: integer(field(raw, 'delaySeconds'), '等待秒数', 1, 3600), message: string(field(raw, 'message'), '提示语', 1000),
    buttonText: string(field(raw, 'buttonText'), '按钮文字', 40), priority: integer(field(raw, 'priority'), '优先级', -1000, 1000),
    createdAt: integer(field(raw, 'createdAt'), '创建时间', 0, Number.MAX_SAFE_INTEGER),
  };
}
export function validateConfig(value: unknown): Config {
  const raw = object(value, '配置文件');
  if (field(raw, 'version') !== 1) throw new Error('配置版本不受支持，需要 version: 1');
  const rules = field(raw, 'rules');
  if (!Array.isArray(rules) || rules.length > 200) throw new Error('配置最多包含 200 条规则');
  const checked = rules.map(validateRule);
  if (new Set(checked.map((rule) => rule.id)).size !== checked.length) throw new Error('配置中的规则 ID 不能重复');
  const config: Config = { version: 1, rules: checked };
  // Match the human-readable export exactly, including its terminating newline.
  const bytes = new TextEncoder().encode(JSON.stringify(config, null, 2) + '\n').byteLength;
  if (bytes > MAX_CONFIG_BYTES) throw new Error('配置导出大小不能超过 2 MiB，请减少规则、例外网址或提示语');
  return config;
}
