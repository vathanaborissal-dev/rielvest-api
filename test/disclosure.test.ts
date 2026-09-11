import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDisclosure,
  isDividendProposal,
  parseDisclosureDate,
  parseDividendDisclosure,
  toPlainText,
} from '../src/ingest/parsers/disclosure.ts';

/**
 * Fixtures are real disclosure bodies from csx.com.kh, trimmed but otherwise
 * unaltered. They cover the formats issuers actually use, which differ enough
 * that a parser written against one of them fails on the others.
 */

describe('toPlainText', () => {
  it('strips markup and decodes the entities CSX emits', () => {
    const html = '<p>Dividend&nbsp;Per Share KHR&nbsp;555</p><p>ACLEDA&rsquo;s board</p>';
    assert.equal(toPlainText(html), 'Dividend Per Share KHR 555 ACLEDA’s board');
  });

  it('returns an empty string for a missing body', () => {
    assert.equal(toPlainText(null), '');
    assert.equal(toPlainText(undefined), '');
  });
});

describe('parseDisclosureDate', () => {
  it('reads every shape issuers use', () => {
    assert.equal(parseDisclosureDate('2026-05-07'), '2026-05-07');
    assert.equal(parseDisclosureDate('May 29, 2017'), '2017-05-29');
    assert.equal(parseDisclosureDate('08/06/2017'), '2017-06-08');
  });

  it('rejects text that is not a date', () => {
    assert.equal(parseDisclosureDate('2 - Total'), null);
    assert.equal(parseDisclosureDate(undefined), null);
  });
});

describe('parseDividendDisclosure', () => {
  it('reads ACLEDA’s numbered-field format', () => {
    const body =
      '1 - Type of Dividend Cash 2 - Total Dividend Amount KHR 240,405,475,545 ' +
      '3 - Dividend Payout Ratio 29.99% 4 - Dividend Per Share KHR 555 ' +
      '5 - Dividend Period Annually 6 - Record Date 2026-05-07 7 - Payment Date 2026-06-05 ' +
      '8 - Date of Resolution 2026-04-23';

    const parsed = parseDividendDisclosure(body);
    assert.ok(parsed);
    assert.equal(parsed.amountPerShareKhr, 555);
    assert.equal(parsed.totalAmountKhr, 240_405_475_545);
    assert.equal(parsed.payoutRatioPercent, 29.99);
    assert.equal(parsed.frequency, 'Annually');
    assert.equal(parsed.recordDate, '2026-05-07');
    assert.equal(parsed.paymentDate, '2026-06-05');
    assert.equal(parsed.dividendType, 'cash');
  });

  it('reads Phnom Penh SEZ’s colon-separated format with a KHR/SHARE unit', () => {
    const body =
      'PPSP will distribute the dividend as below: 1. Type of dividend : Cash ' +
      '2. Period of dividend : 2016 3. Dividend payout ratio : 20% ' +
      '4. Total dividend : KHR 1,167,236,000 5. Dividend per share: KHR/SHARE 20.17 ' +
      '6. Record date : May 29, 2017 7. Payment date : June 08, 2017';

    const parsed = parseDividendDisclosure(body);
    assert.ok(parsed);
    assert.equal(parsed.amountPerShareKhr, 20.17);
    assert.equal(parsed.totalAmountKhr, 1_167_236_000);
    assert.equal(parsed.payoutRatioPercent, 20);
    assert.equal(parsed.recordDate, '2017-05-29');
    assert.equal(parsed.paymentDate, '2017-06-08');
  });

  it('reads CAMGSM’s quarterly declaration quoted in riel', () => {
    const body =
      '1 - Type of Dividend Cash 2 - Total Dividend Amount Riel 368,298,658 ' +
      '3 - Dividend Payout Ratio 0.2 percent 4 - Dividend Per Share Riel 39.725 ' +
      '5 - Dividend Period Quarterly 6 - Record Date 2026-04-23 7 - Payment Date 2026-05-11';

    const parsed = parseDividendDisclosure(body);
    assert.ok(parsed);
    assert.equal(parsed.amountPerShareKhr, 39.725);
    assert.equal(parsed.frequency, 'Quarterly');
  });

  it('returns nothing for a decision NOT to distribute', () => {
    const body =
      'Decision on Non-Dividend Distribution. The board resolved not to distribute ' +
      'a dividend. Dividend Per Share KHR 0';
    assert.equal(parseDividendDisclosure(body), null);
  });

  it('returns nothing for a prose notice with no per-share figure', () => {
    const body =
      'PPWSA is pleased to announce that the board has resolved to distribute 2023 ' +
      'dividends to its ordinary shareholders by choosing a record date different ' +
      'from that of the General Meeting of Shareholders.';
    assert.equal(parseDividendDisclosure(body), null);
  });

  it('rejects a per-share figure larger than any CSX share price', () => {
    // Guards against a stray match swallowing the total distribution.
    const body = 'Dividend Per Share KHR 240,405,475,545';
    assert.equal(parseDividendDisclosure(body), null);
  });

  it('ignores a payout ratio outside 0-100', () => {
    const body = 'Dividend Per Share KHR 100 Dividend Payout Ratio 4000%';
    const parsed = parseDividendDisclosure(body);
    assert.ok(parsed);
    assert.equal(parsed.payoutRatioPercent, null);
  });
});

describe('classifyDisclosure', () => {
  it('separates a declaration from a refusal to declare', () => {
    assert.equal(classifyDisclosure('[Disclosure] Decision on Dividend Distribution'), 'dividend');
    assert.equal(
      classifyDisclosure('[Disclosure] Decision on Non-Dividend Distribution'),
      'announcement',
    );
  });

  it('recognises periodic reports', () => {
    assert.equal(classifyDisclosure('[Disclosure] Third Quarterly Report of PEPC'), 'report');
    assert.equal(classifyDisclosure('[Disclosure] Annual Report 2025'), 'report');
  });
});

describe('isDividendProposal', () => {
  it('separates a board proposal from the decision that follows it', () => {
    assert.equal(
      isDividendProposal(
        '[Disclosure] Decision on Proposal of the Board of Directors on Dividend Distribution',
      ),
      true,
    );
    assert.equal(isDividendProposal('[Disclosure] Decision on Dividend Distribution'), false);
  });
});
