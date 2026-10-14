export interface Cursor { tabId: number; url: string; at: number; blocked: boolean }
export interface PageSession { url: string; acks: string[]; waits: Record<string,number>; lastEvent: string }
/** A fresh heartbeat is evidence of browsing, a long gap is not. Never charge sleep/offline time. */
export function elapsedInterval(cursor: Cursor | null, now: number): [number,number] | null {
  if (!cursor || cursor.blocked || now <= cursor.at || now - cursor.at > 5000) return null;
  return [cursor.at,now];
}
export function updatePageSession(previous: PageSession | undefined, url: string): PageSession {
  return previous?.url === url ? previous : {url,acks:[],waits:{},lastEvent:''};
}
export function pruneUsage<T>(usage: Record<string,T>, limit = 8): Record<string,T> {
  return Object.fromEntries(Object.keys(usage).sort().slice(-limit).map(key=>[key,usage[key]]));
}

/** Absolute deadline survives service-worker restarts. */
export function waitDeadline(page: PageSession, id: string, now: number, seconds: number): number {
  if (!Object.hasOwn(page.waits,id) || !Number.isFinite(page.waits[id])) page.waits[id] = now + seconds * 1000;
  return page.waits[id];
}
