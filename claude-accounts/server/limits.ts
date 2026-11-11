/**
 * Recognizes Claude subscription usage limits in a failed turn's error or its final output, and
 * works out when the limit resets.
 *
 * Claude Code has phrased the limit several ways:
 *   "Claude AI usage limit reached|1757001600"
 *   "5-hour limit reached ∙ resets 2pm"
 *   "You've hit your limit · resets 6pm (Europe/Berlin)"
 *   "Weekly limit reached ∙ resets Mon 9am"
 *   "You're out of extra usage · resets 3:30pm"
 *
 * Per-minute API rate limits (HTTP 429 rate_limit_error) are retried by Claude Code itself and
 * are deliberately not matched.
 */
const LIMIT_PATTERNS = [
  /usage limit reached/i,
  /hit your (?:usage |session |weekly )?limit/i,
  /\b(?:5-hour|five-hour|session|weekly|opus|sonnet|daily)\s+limit reached/i,
  /out of (?:extra )?usage/i,
  /limit reached\s*[·∙•|-]\s*resets/i,
];

/** Output longer than this is a real answer that happens to mention limits, not a limit notice. */
const MAX_NOTICE_LENGTH = 600;

/** When Claude does not say when the limit resets, try the account again after this long. */
const FALLBACK_COOLDOWN_MS = 60 * 60 * 1000;

export function isUsageLimit(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_NOTICE_LENGTH) return false;
  return LIMIT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Reset time named in a limit notice, or a fallback cooldown from `now`. */
export function resetTime(text: string, now = new Date()): Date {
  const epoch = /limit reached\|(\d{10,13})/i.exec(text);
  if (epoch) {
    const value = Number(epoch[1]);
    return new Date(value < 1e12 ? value * 1000 : value);
  }

  const clock =
    /resets\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(
      text,
    );
  if (clock) {
    const [, day, hourText, minuteText, meridiem] = clock;
    let hour = Number(hourText);
    const minute = minuteText ? Number(minuteText) : 0;
    if (meridiem) {
      const pm = meridiem.toLowerCase() === "pm";
      hour = (hour % 12) + (pm ? 12 : 0);
    }
    if (hour < 24 && minute < 60) {
      // The notice uses the user's timezone; the daemon normally runs in the same one.
      const reset = new Date(now);
      reset.setHours(hour, minute, 0, 0);
      if (day) {
        const target = WEEKDAYS.indexOf(day.toLowerCase().slice(0, 3));
        const ahead = (target - reset.getDay() + 7) % 7;
        reset.setDate(reset.getDate() + ahead);
        if (reset <= now) reset.setDate(reset.getDate() + 7);
      } else if (reset <= now) {
        reset.setDate(reset.getDate() + 1);
      }
      return reset;
    }
  }

  return new Date(now.getTime() + FALLBACK_COOLDOWN_MS);
}
