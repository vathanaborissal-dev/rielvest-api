import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocationBy,
  replayLedger,
  summarise,
  valueHoldings,
  type LedgerEntry,
  type PriceLookup,
} from '../src/modules/portfolio/portfolio.calculations.ts';

let sequence = 0;
function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, 'type' | 'tradeDate'>): LedgerEntry {
  sequence += 1;
  return {
    id: `t${sequence}`,
    companyId: null,
    symbol: null,
    quantity: null,
    price: null,
    amount: null,
    fees: 0,
    taxes: 0,
    createdAt: `2020-01-01T00:00:${String(sequence).padStart(2, '0')}Z`,
    ...partial,
  };
}

const buy = (tradeDate: string, quantity: number, price: number, fees = 0) =>
  entry({ type: 'BUY', tradeDate, companyId: 'c1', symbol: 'ABC', quantity, price, fees });

const sell = (tradeDate: string, quantity: number, price: number, fees = 0) =>
  entry({ type: 'SELL', tradeDate, companyId: 'c1', symbol: 'ABC', quantity, price, fees });

describe('replayLedger — cost basis', () => {
  it('capitalises purchase costs into the average cost', () => {
    const { holdings } = replayLedger([buy('2024-01-10', 100, 9_000, 5_000)]);
    const position = holdings[0]!;
    assert.equal(position.quantity, 100);
    assert.equal(position.costBasis, 905_000);
    assert.equal(position.averageCost, 9_050);
  });

  it('re-averages cost across purchases at different prices', () => {
    const { holdings } = replayLedger([buy('2024-01-10', 100, 9_000), buy('2024-02-10', 100, 11_000)]);
    const position = holdings[0]!;
    assert.equal(position.quantity, 200);
    assert.equal(position.averageCost, 10_000);
  });

  it('leaves average cost unchanged after a partial sale', () => {
    const { holdings } = replayLedger([
      buy('2024-01-10', 100, 9_000),
      buy('2024-02-10', 100, 11_000),
      sell('2024-03-10', 50, 12_000),
    ]);
    const position = holdings[0]!;
    assert.equal(position.quantity, 150);
    assert.equal(position.averageCost, 10_000);
    // Sold 50 at 12,000 against an average cost of 10,000.
    assert.equal(position.realisedPnl, 100_000);
  });

  it('deducts selling costs from proceeds rather than from cost basis', () => {
    const { holdings } = replayLedger([buy('2024-01-10', 100, 10_000), sell('2024-03-10', 50, 12_000, 7_000)]);
    // (50 x 12,000) - 7,000 fees - (50 x 10,000) cost = 93,000
    assert.equal(holdings[0]!.realisedPnl, 93_000);
  });

  it('closes the position out completely when everything is sold', () => {
    const result = replayLedger([buy('2024-01-10', 100, 10_000), sell('2024-03-10', 100, 12_000)]);
    assert.equal(result.holdings.length, 0);
    assert.equal(result.closed.length, 1);
    assert.equal(result.closed[0]!.realisedPnl, 200_000);
    assert.equal(result.closed[0]!.costBasis, 0);
  });

  it('applies trades in date order regardless of entry order', () => {
    const later = sell('2024-03-10', 50, 12_000);
    const earlier = buy('2024-01-10', 100, 10_000);
    const { holdings } = replayLedger([later, earlier]);
    assert.equal(holdings[0]!.quantity, 50);
    assert.equal(holdings[0]!.realisedPnl, 100_000);
  });

  it('warns when a sale exceeds the shares on record instead of going negative', () => {
    const result = replayLedger([buy('2024-01-10', 10, 10_000), sell('2024-03-10', 100, 12_000)]);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /exceeds the 10 shares recorded/);
    // The position empties rather than turning negative.
    assert.equal(result.holdings.length, 0);
  });
});

describe('replayLedger — cash', () => {
  it('tracks deposits, purchases, sales and dividends through the cash balance', () => {
    const { cash } = replayLedger([
      entry({ type: 'DEPOSIT', tradeDate: '2024-01-01', amount: 10_000_000 }),
      buy('2024-01-10', 100, 10_000, 5_000),
      entry({
        type: 'DIVIDEND',
        tradeDate: '2024-06-01',
        companyId: 'c1',
        symbol: 'ABC',
        amount: 55_500,
      }),
      sell('2024-07-01', 50, 12_000, 3_000),
    ]);

    assert.equal(cash.deposits, 10_000_000);
    assert.equal(cash.invested, 1_005_000);
    assert.equal(cash.dividends, 55_500);
    assert.equal(cash.proceeds, 597_000);
    assert.equal(cash.cash, 10_000_000 - 1_005_000 + 55_500 + 597_000);
    assert.equal(cash.fees, 8_000);
  });
});

describe('valueHoldings', () => {
  const prices = new Map<string, PriceLookup>([
    ['c1', { close: 11_000, change: 100, tradeDate: '2026-09-11', sector: 'Financials', name: 'ACLEDA Bank' }],
  ]);

  it('values the position and derives weight and day change', () => {
    const { holdings } = replayLedger([buy('2024-01-10', 100, 10_000)]);
    const valued = valueHoldings(holdings, prices)[0]!;
    assert.equal(valued.marketValue, 1_100_000);
    assert.equal(valued.unrealisedPnl, 100_000);
    assert.equal(valued.unrealisedPnlPercent, 10);
    assert.equal(valued.weight, 100);
    assert.equal(valued.dayChange, 10_000);
  });

  it('nets dividends already received off the break-even price', () => {
    const { holdings } = replayLedger([
      buy('2024-01-10', 100, 10_000, 5_000),
      entry({ type: 'DIVIDEND', tradeDate: '2024-06-01', companyId: 'c1', symbol: 'ABC', amount: 50_000 }),
    ]);
    const valued = valueHoldings(holdings, prices)[0]!;
    // (1,005,000 cost - 50,000 dividends) / 100 shares
    assert.equal(valued.breakEvenPrice, 9_550);
  });

  it('reports no market value when the stock has no price rather than assuming zero', () => {
    const { holdings } = replayLedger([buy('2024-01-10', 100, 10_000)]);
    const valued = valueHoldings(holdings, new Map())[0]!;
    assert.equal(valued.marketValue, null);
    assert.equal(valued.unrealisedPnl, null);
    assert.equal(valued.weight, null);
  });
});

describe('summarise', () => {
  it('adds unrealised, realised and dividends into one total return', () => {
    const prices = new Map<string, PriceLookup>([
      ['c1', { close: 11_000, change: 0, tradeDate: '2026-09-11', sector: 'Financials', name: 'ACLEDA Bank' }],
    ]);
    const ledger = replayLedger([
      entry({ type: 'DEPOSIT', tradeDate: '2024-01-01', amount: 5_000_000 }),
      buy('2024-01-10', 200, 10_000),
      sell('2024-06-10', 100, 12_000),
      entry({ type: 'DIVIDEND', tradeDate: '2024-07-01', companyId: 'c1', symbol: 'ABC', amount: 30_000 }),
    ]);
    const valued = valueHoldings(ledger.holdings, prices);
    const summary = summarise(valued, ledger.closed, ledger.cash);

    assert.equal(summary.marketValue, 1_100_000);
    assert.equal(summary.unrealisedPnl, 100_000);
    assert.equal(summary.realisedPnl, 200_000);
    assert.equal(summary.dividends, 30_000);
    assert.equal(summary.totalReturn, 330_000);
    assert.equal(summary.positions, 1);
    assert.equal(summary.hasUnpricedHoldings, false);
  });

  it('flags an unpriced holding so the totals are not read as complete', () => {
    const ledger = replayLedger([buy('2024-01-10', 100, 10_000)]);
    const summary = summarise(valueHoldings(ledger.holdings, new Map()), ledger.closed, ledger.cash);
    assert.equal(summary.hasUnpricedHoldings, true);
  });
});

describe('allocationBy', () => {
  it('groups by sector and returns percentages that sum to 100', () => {
    const prices = new Map<string, PriceLookup>([
      ['c1', { close: 10_000, change: 0, tradeDate: '2026-09-11', sector: 'Financials', name: 'ACLEDA Bank' }],
      ['c2', { close: 10_000, change: 0, tradeDate: '2026-09-11', sector: 'Utilities', name: 'PWSA' }],
    ]);
    const ledger = replayLedger([
      buy('2024-01-10', 300, 10_000),
      entry({ type: 'BUY', tradeDate: '2024-01-10', companyId: 'c2', symbol: 'PWSA', quantity: 100, price: 10_000 }),
    ]);
    const slices = allocationBy(valueHoldings(ledger.holdings, prices), (holding) => holding.sector);

    assert.equal(slices.length, 2);
    assert.equal(slices[0]!.label, 'Financials');
    assert.equal(slices[0]!.percent, 75);
    assert.equal(Math.round(slices.reduce((sum, slice) => sum + slice.percent, 0)), 100);
  });
});
