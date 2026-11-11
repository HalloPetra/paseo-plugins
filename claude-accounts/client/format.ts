/** "3:00 PM" today, "Mon 9:00 AM" within a week, otherwise a short date. */
export function formatTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  const days = (date.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 6) {
    return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  }
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}
