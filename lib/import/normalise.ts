// Normalisation, in the order of PRD 7.2. The parser scans the cleaned line case-insensitively with the
// same tolerance, so the free note keeps its original case. This function exposes the canonical text.

/** 1. NFKC, replace non-breaking spaces, tabs and zero-width characters with a space, collapse and trim. */
export function cleanWhitespace(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[ \t​‌‍﻿⁠]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Steps 2 to 7: upper-case everything except the free note, remove spaces around slashes, rewrite time
 * tokens as "ETD/HH.MMZ" (STD becomes ETD), split glued markers, normalise day tags and flight numbers.
 * Time values that cannot be read as HH.MM, HH:MM or HHMM are left as typed, so the parser can flag them.
 */
export function normaliseLine(raw: string): string {
  let s = cleanWhitespace(raw);
  // 7. flight numbers: "CMS572 D" and "CMS 572D" become "CMS572D" (only at the start of the line)
  s = s.replace(/^([A-Za-z]{3})\s?(\d{1,4})\s?([A-Za-z])(?=\s+[A-Za-z]{4}\s*\/)/, "$1$2$3").replace(/^([A-Za-z]{3})\s(\d{1,4})(?=\s)/, "$1$2");
  // 3. spaces around slashes: "UGTB / TBS" becomes "UGTB/TBS"
  s = s.replace(/\s*\/\s*/g, "/");
  // 4. time tokens
  s = s.replace(/\b(ETD|ETA|STD)\s*[/: ]\s*(\d{1,2})[.:]?(\d{2})(?:\s*Z)?/gi, (_m, tag: string, hh: string, mm: string) => {
    return `${tag.toUpperCase() === "STD" ? "ETD" : tag.toUpperCase()}/${hh.padStart(2, "0")}.${mm}Z`;
  });
  // 5. glued markers: "06.30Z+" becomes "06.30Z +"
  s = s.replace(/(\d{2}\.\d{2}Z)([+-])/g, "$1 $2");
  // 6. day tags: "DAY4 LT", "(DAY4LT)", "(DAY 4 LT)" become "DAY 4 LT"
  s = s.replace(/\(?\s*DAY\s*([1-7])\s*LT\s*\)?/gi, "DAY $1 LT");
  // 2. upper-case everything up to the free note
  const noteAt = noteStart(s);
  return (noteAt < 0 ? s.toUpperCase() : s.slice(0, noteAt).toUpperCase() + s.slice(noteAt)).replace(/\s+/g, " ").trim();
}

/** Index where the free note starts in an already-normalised line, or -1. */
function noteStart(s: string): number {
  const m = /^\S+\s+[A-Za-z]{4}\/[A-Za-z]{3}\s+ETD\/\S+\s+[A-Za-z]{4}\/[A-Za-z]{3}\s+ETA\/\S+/i.exec(s);
  if (!m) return -1;
  let i = m[0].length;
  const tail = /^\s+(?:DAY \d LT|[+-](?=\s|$)|CNL(?=\s|$)|FERRY(?=\s|$)|OVERFLIGHT(?=\s|$)|TECHSTOP(?=\s|$))/i;
  for (;;) {
    const t = tail.exec(s.slice(i));
    if (!t) break;
    i += t[0].length;
  }
  const rest = s.slice(i);
  return /\S/.test(rest) ? i + (rest.length - rest.trimStart().length) : -1;
}
