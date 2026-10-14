export type Action = 'remind' | 'delay' | 'block';
export interface Matcher { kind: 'site' | 'path' | 'page'; value: string; includeSubdomains: boolean; ignoreQuery: boolean; ignoreHash: boolean }
export interface Schedule { enabled: boolean; days: number[]; start: string; end: string }
export interface Rule { id: string; name: string; enabled: boolean; match: Matcher; exceptions: Matcher[]; schedule: Schedule; quotaMinutes: number; action: Action; delaySeconds: number; message: string; buttonText: string; priority: number; createdAt: number }
export interface Config { version: 1; rules: Rule[] }
export interface Usage { [date: string]: { [ruleId: string]: number } }
export interface Grant { ruleId: string; expiresAt: number }
export interface LogEntry { id: string; at: number; ruleId: string; ruleName: string; action: Action | 'bypass'; url: string; detail: string }
export interface LocalState { config: Config; usage: Usage; grants: Grant[]; logs: LogEntry[] }
export interface Decision { rule: Rule | null; matched: Rule[]; reason: string; usedMs: number }
export interface PageView { url: string; supported: boolean; rule: Rule | null; reason: string; usedMs: number; waitUntil?: number; granted?: boolean; matchedNames: string[] }
export interface Snapshot extends LocalState { view?: PageView; tabId?: number; now: number }
export type Request = { type: 'GET_STATE'; tabId?: number } | { type: 'SAVE_RULE'; rule: Rule } | { type: 'DELETE_RULE'; id: string } | { type: 'TOGGLE_RULE'; id: string; enabled: boolean } | { type: 'IMPORT_CONFIG'; config: unknown } | { type: 'CLEAR_LOGS' } | { type: 'BYPASS'; id: string; minutes?: number } | { type: 'REVOKE_BYPASS'; id: string } | { type: 'TICK' } | { type: 'ACK'; ruleId: string; pageUrl: string } | { type: 'OPEN_OPTIONS' } | { type: 'CLOSE_TAB' };
export type Response<T = Snapshot> = { ok: true; data: T } | { ok: false; error: string };
