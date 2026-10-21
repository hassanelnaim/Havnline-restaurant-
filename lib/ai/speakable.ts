/**
 * Turns a reply written as text into something a voice can read out
 * cleanly. The AI writes like a chat ("1 x Cheeseburger — $8.49",
 * "Kids (1/4lb) Burger", "w/ cheese", "**Total:**"), and a text-to-speech
 * voice reads those symbols literally or garbles them ("one ex cheeseburger
 * dash..."). Every line spoken on a call goes through this, in sayLine, so
 * no reply, filler or fixed line can reach the caller in chat form.
 *
 * Only what's spoken changes: the transcript keeps the AI's original words.
 * Plain sentences come out unchanged, so fixed lines (and their cached
 * audio) are unaffected.
 */

function moneyToWords(dollarsRaw: string, cents: string | undefined): string {
  const dollars = parseInt(dollarsRaw.replace(/,/g, ""), 10) || 0;
  const c = cents ? parseInt(cents.padEnd(2, "0").slice(0, 2), 10) : 0;
  const dollarPart = `${dollars.toLocaleString("en-US")} dollar${dollars === 1 ? "" : "s"}`;
  if (c === 0) return dollars === 0 ? "zero dollars" : dollarPart;
  const centPart = `${c} cent${c === 1 ? "" : "s"}`;
  return dollars === 0 ? centPart : `${dollarPart} and ${centPart}`;
}

export function toSpeech(input: string): string {
  let t = input;

  // Markdown and list formatting: never meant to be heard.
  t = t.replace(/\*\*|__|`/g, "");
  t = t.replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,!?]|$)/g, "$1$2");
  t = t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "");
  t = t.replace(/\s*\n+\s*/g, (m, offset: number, whole: string) => (/[.!?,:;]$/.test(whole.slice(0, offset).trimEnd()) ? " " : ". "));

  // Abbreviations and symbols people don't say.
  t = t.replace(/\bw\/o\b/gi, "without").replace(/\bw\/\s*/gi, "with ");
  t = t.replace(/\be\.g\.,?/gi, "for example").replace(/\bi\.e\.,?/gi, "that is").replace(/\betc\.(?=\s+[A-Z]|\s*$)/g, "and so on.").replace(/\betc\./gi, "and so on").replace(/\bapprox\.?/gi, "about");
  t = t.replace(/\s*&\s*/g, " and ");
  t = t.replace(/(\d)\s*%/g, "$1 percent");
  t = t.replace(/#\s?(\d+)/g, "number $1");
  t = t.replace(/\s@\s/g, " at ");

  // Sizes written the menu way: "1/4lb", "(9oz)", "2 lbs".
  t = t.replace(/\b1\/4\s*(lb|lbs|pound)\b/gi, "quarter pound").replace(/\b1\/2\s*(lb|lbs|pound)\b/gi, "half pound").replace(/\b1\/3\s*(lb|lbs|pound)\b/gi, "third pound");
  t = t.replace(/\b1\/2\b/g, "half").replace(/\b1\/4\b/g, "quarter");
  t = t.replace(/(\d)\s*(lbs?)\b/gi, (_m, n: string) => `${n} pound${n === "1" ? "" : "s"}`);
  t = t.replace(/(\d)\s*oz\b/gi, "$1 ounce");

  // Prices: "+$1.50" -> "plus 1 dollar and 50 cents", "$8.49" -> "8 dollars and 49 cents".
  t = t.replace(/\+\s*\$/g, "plus $");
  t = t.replace(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\b/g, (_m, d: string, c: string | undefined) => moneyToWords(d, c));

  // Quantities written "1 x Cheeseburger", "2x Coke", "3 × fries".
  t = t.replace(/\b(\d+)\s*[x×]\s*(?=[A-Za-z(])/gi, "$1 ");
  // A count in brackets at the start of a name: "(2) Coneys" -> "2 Coneys".
  t = t.replace(/\((\d+)\)\s*/g, "$1 ");
  // Other brackets become a short pause around what's inside.
  t = t.replace(/\s*\(([^()]*)\)/g, (_m, inner: string) => (inner.trim() ? `, ${inner.trim()},` : ""));
  // Dashes between words are a pause, not a word.
  t = t.replace(/\s+[—–-]\s+/g, ", ").replace(/—|–/g, ", ");
  // Symbols that carry nothing when spoken.
  t = t.replace(/[*_~^|<>{}\[\]\\]/g, " ");

  // Tidy the punctuation left behind.
  t = t.replace(/\s+([,.!?;:])/g, "$1");
  t = t.replace(/,(\s*,)+/g, ",");
  t = t.replace(/,(\s*[.!?])/g, "$1");
  t = t.replace(/([.!?])\s*,/g, "$1");
  t = t.replace(/\.{2,}(?!\.)/g, ".");
  t = t.replace(/\s{2,}/g, " ");
  return t.trim();
}
