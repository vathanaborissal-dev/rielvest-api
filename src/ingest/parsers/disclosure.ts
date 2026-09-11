/**
 * Readers for CSX disclosure bodies.
 *
 * Disclosures are HTML written by each issuer, so the wording varies: ACLEDA
 * files numbered fields ("4 - Dividend Per Share KHR 555"), Phnom Penh SEZ uses
 * colons ("5. Dividend per share: KHR/SHARE 20.17"), and some older notices are
 * pure prose with no figure at all.
 *
 * The rule throughout is that an ambiguous disclosure yields nothing. A missing
 * dividend is a visible gap RielVest can explain; a wrong one silently corrupts
 * every yield, payout ratio and income projection built on top of it.
 */

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

/** Strips markup and collapses whitespace so patterns can span original tags. */
export function toPlainText(html: string | null | undefined): string {
  if (!html) return '';
  let text = html.replace(/<[^>]+>/g, ' ');
  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(replacement);
  }
  text = text.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
  return text.replace(/\s+/g, ' ').trim();
}

/** Parses "555", "1,167,236,000" or "227.8049" into a number. */
function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Parses the several date shapes issuers use: "2026-05-07", "May 29, 2017",
 * "29 May 2017" and "29/05/2017".
 */
export function parseDisclosureDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return text;

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slashed) {
    const [, day, month, year] = slashed;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }

  // Parse as UTC explicitly. Without the suffix these formats are read in the
  // host's local zone, and converting back to an ISO date then shifts every
  // record and payment date a day earlier anywhere east of Greenwich.
  const parsed = Date.parse(`${text} UTC`);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    // Reject anything outside the exchange's lifetime; a stray parse of a
    // fragment like "2 - Total" must not become a date.
    const year = date.getUTCFullYear();
    if (year >= 2011 && year <= 2100) return date.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * A board *proposing* a dividend is not a declared dividend.
 *
 * Issuers file a proposal ahead of the shareholder meeting and then a decision
 * afterwards, both in the same structured format and usually for the same
 * amount. Recording both double-counts the payout and doubles every yield
 * computed from it.
 */
export function isDividendProposal(title: string): boolean {
  return /proposal of the board|board of directors on dividend|proposed dividend/i.test(title);
}

export interface ParsedDividend {
  amountPerShareKhr: number;
  totalAmountKhr: number | null;
  payoutRatioPercent: number | null;
  frequency: string | null;
  recordDate: string | null;
  paymentDate: string | null;
  resolutionDate: string | null;
  dividendType: 'cash' | 'stock' | 'special';
}

/** Matches "KHR 555", "Riel 39.725", "KHR/SHARE 20.17" and bare numbers. */
const PER_SHARE = /dividend\s*per\s*share\s*[:\-]?\s*(?:KHR|Riel|USD)?\s*(?:\/\s*SHARE)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i;
const TOTAL = /total\s*dividend(?:\s*amount)?\s*[:\-]?\s*(?:KHR|Riel)?\s*([\d,]+(?:\.\d+)?)/i;
const RATIO = /dividend\s*payout\s*ratio\s*[:\-]?\s*([\d.]+)\s*(%|percent)?/i;
const FREQUENCY = /dividend\s*period\s*[:\-]?\s*(Annually|Quarterly|Semi-?annually|Monthly)/i;
const RECORD = /record\s*date\s*(?:of[^:]*)?[:\-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i;
const PAYMENT = /payment\s*date\s*[:\-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i;
const RESOLUTION = /date\s*of\s*resolution\s*[:\-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i;
const TYPE = /type\s*of\s*dividend\s*[:\-]?\s*(Cash|Stock|Share|Special)/i;

/**
 * Extracts a dividend declaration, or returns null when the disclosure does not
 * state one unambiguously.
 *
 * A per-share amount is mandatory: it is the figure every downstream measure
 * depends on, and a disclosure without it (a notice of a record-date change,
 * say, or a decision *not* to distribute) is not a dividend record.
 */
export function parseDividendDisclosure(html: string | null | undefined): ParsedDividend | null {
  const text = toPlainText(html);
  if (!text) return null;

  // "Decision on Non-Dividend Distribution" announces the absence of one.
  if (/non-?dividend/i.test(text)) return null;

  const amountPerShareKhr = parseAmount(PER_SHARE.exec(text)?.[1]);
  if (amountPerShareKhr === null) return null;

  // Guard against a stray match swallowing an unrelated figure: a per-share
  // dividend far above the largest CSX share price is not a per-share figure.
  if (amountPerShareKhr > 100_000) return null;

  const ratioMatch = RATIO.exec(text);
  const ratioValue = ratioMatch ? Number(ratioMatch[1]) : null;

  const typeWord = TYPE.exec(text)?.[1]?.toLowerCase();
  const dividendType: ParsedDividend['dividendType'] =
    typeWord === 'stock' || typeWord === 'share'
      ? 'stock'
      : typeWord === 'special'
        ? 'special'
        : 'cash';

  return {
    amountPerShareKhr,
    totalAmountKhr: parseAmount(TOTAL.exec(text)?.[1]),
    payoutRatioPercent:
      ratioValue !== null && Number.isFinite(ratioValue) && ratioValue >= 0 && ratioValue <= 100
        ? ratioValue
        : null,
    frequency: FREQUENCY.exec(text)?.[1] ?? null,
    recordDate: parseDisclosureDate(RECORD.exec(text)?.[1]),
    paymentDate: parseDisclosureDate(PAYMENT.exec(text)?.[1]),
    resolutionDate: parseDisclosureDate(RESOLUTION.exec(text)?.[1]),
    dividendType,
  };
}

/** Classifies a disclosure from its title, for the events feed. */
export function classifyDisclosure(
  title: string,
): 'dividend' | 'report' | 'listing' | 'suspension' | 'regulatory' | 'announcement' {
  if (/non-?dividend/i.test(title)) return 'announcement';
  if (/dividend/i.test(title)) return 'dividend';
  if (/quarterly report|annual report|financial statement|audited|interim report/i.test(title)) {
    return 'report';
  }
  if (/listing|ipo|initial public offering|first trading/i.test(title)) return 'listing';
  if (/suspend|suspension|halt|delist/i.test(title)) return 'suspension';
  if (/prakas|regulation|approval|serc|license/i.test(title)) return 'regulatory';
  return 'announcement';
}
