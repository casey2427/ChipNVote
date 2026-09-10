export type RecentEventKind = "vote" | "time";

export type RecentEvent = {
  inviteCode: string;
  question: string;
  kind: RecentEventKind;
  path: string;
  lastOpenedAt: number;
};

const RECENT_EVENTS_KEY = "chipnvote:recent-events-v1";
const MAX_RECENT_EVENTS = 8;

function readStoredEvents(): RecentEvent[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(RECENT_EVENTS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is RecentEvent =>
      item &&
      typeof item.inviteCode === "string" &&
      typeof item.question === "string" &&
      (item.kind === "vote" || item.kind === "time") &&
      typeof item.path === "string" &&
      typeof item.lastOpenedAt === "number"
    );
  } catch {
    return [];
  }
}

export function getRecentEvents() {
  return readStoredEvents()
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, MAX_RECENT_EVENTS);
}

export function rememberRecentEvent(event: Omit<RecentEvent, "lastOpenedAt">) {
  if (typeof window === "undefined") return;

  try {
    const next: RecentEvent[] = [
      { ...event, lastOpenedAt: Date.now() },
      ...readStoredEvents().filter((item) => item.inviteCode !== event.inviteCode),
    ].slice(0, MAX_RECENT_EVENTS);

    window.localStorage.setItem(RECENT_EVENTS_KEY, JSON.stringify(next));
  } catch {
    // Browsers can block localStorage in private or restricted contexts.
  }
}
