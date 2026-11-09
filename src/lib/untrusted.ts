/**
 * Untrusted data for prompts (12.4). Job descriptions, company names and
 * user text are data, never instructions: each piece is wrapped in one tag
 * it cannot close, escaped and cut to 2 000 characters.
 */

export const UNTRUSTED_MAX_CHARS = 2000;

const SOURCE =
  /^(?:job:[A-Za-z0-9-]{1,64}|company:[A-Za-z0-9-]{1,64}|ugc:[A-Za-z0-9-]{1,64}|event:[a-z0-9-]{1,120}|service:[A-Za-z0-9-]{1,64}|order:[A-Za-z0-9-]{1,64}|freelance_task:[A-Za-z0-9-]{1,64}|freelance_title|shown_jobs|user_message)$/;

export class UntrustedSourceError extends Error {
  constructor(source: string) {
    super(`Untrusted source not allowed: ${JSON.stringify(source)}`);
    this.name = "UntrustedSourceError";
  }
}

// Control characters other than tab and newline could hide text from review.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

/** `&`, `<`, `>` escaped: no tag can be opened or closed from inside. */
export function escapeUntrusted(text: string): string {
  return text
    .replace(CONTROL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Cuts by code points so a surrogate pair is never split. */
function truncate(text: string, max: number): { text: string; cut: boolean } {
  const points = Array.from(text);
  if (points.length <= max) return { text, cut: false };
  return { text: points.slice(0, max).join(""), cut: true };
}

export function wrapUntrusted(source: string, text: string): string {
  if (!SOURCE.test(source)) throw new UntrustedSourceError(source);
  const { text: kept, cut } = truncate(
    text.replace(CONTROL, ""),
    UNTRUSTED_MAX_CHARS,
  );
  const attrs = cut
    ? ` source="${source}" truncated="true"`
    : ` source="${source}"`;
  return `<untrusted_data${attrs}>${escapeUntrusted(kept)}</untrusted_data>`;
}
