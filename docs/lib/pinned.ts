import fs from "fs";
import path from "path";

export type PinnedStatus = "urgent" | "must-do" | "ongoing" | "done";
export type PinnedTask = {
  id: string;
  title: string;
  owner: string;
  status: PinnedStatus;
  priority: string;
  due?: string;
  area?: string;
  description: string;
  link?: string;
};

const PINNED_PATH = path.join(process.cwd(), "data", "pinned.json");

export function getPinnedTasks(): PinnedTask[] {
  try {
    if (!fs.existsSync(PINNED_PATH)) return [];
    const raw = fs.readFileSync(PINNED_PATH, "utf8");
    const data = JSON.parse(raw) as PinnedTask[];
    // sort: urgent → must-do → ongoing → done, then by priority
    const order: Record<PinnedStatus, number> = { urgent: 0, "must-do": 1, ongoing: 2, done: 3 };
    return [...data].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.priority.localeCompare(b.priority));
  } catch {
    return [];
  }
}

export function getPinnedByStatus(status: PinnedStatus) {
  return getPinnedTasks().filter((t) => t.status === status);
}
