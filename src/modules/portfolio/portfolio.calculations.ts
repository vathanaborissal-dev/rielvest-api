import { pctChange, round } from '../../core/num.ts';

/**
 * Portfolio arithmetic, deliberately free of any database dependency so it can
 * be reasoned about and tested against fixtures.
 *
 * Cost basis uses the **weighted average cost** method: each purchase
 * re-averages the cost of the whole position, and a sale realises profit
 * against that average. This is the convention Cambodian and most Asian retail
 * brokers report on, and unlike FIFO it does not require the user to have
 * entered their trades in the exact order they were filled — which matters for
 * a product where people type in their history from memory.
 *
 * Purchase costs are capitalised into the cost basis and sale costs are
 * deducted from proceeds, mirroring how a contract note actually settles.
 */

export type LedgerType = 'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAWAL';

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  tradeDate: string;
  companyId: string | null;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fees: number;
  taxes: number;
  createdAt: string;
}

export interface HoldingState {
  companyId: string;
  symbol: string;
  quantity: number;
  /** Capital currently tied up in the open position, costs included. */
  costBasis: number;
  averageCost: number;
  realisedPnl: number;
  dividendsReceived: number;
  feesPaid: number;
  firstBought: string | null;
  lastActivity: string | null;
}

export interface CashFlowTotals {
  deposits: number;
  withdrawals: number;
  invested: number;
  proceeds: number;
  dividends: number;
  fees: number;
  taxes: number;
  cash: number;
}

export interface LedgerResult {
  holdings: HoldingState[];
  /** Positions sold out entirely: no shares left, but the P/L still counts. */
  closed: HoldingState[];
  cash: CashFlowTotals;
  warnings: string[];
}

/** Trades settle in date order; same-day entries keep the order they were added. */
function chronological(a: LedgerEntry, b: LedgerEntry): number {
  return a.tradeDate === b.tradeDate
    ? a.createdAt.localeCompare(b.createdAt)
    : a.tradeDate.localeCompare(b.tradeDate);
}

/** Shares are quoted in whole units; this absorbs floating-point dust. */
const EPSILON = 1e-9;

export function replayLedger(entries: LedgerEntry[]): LedgerResult {
  const positions = new Map<string, HoldingState>();
  const warnings: string[] = [];
  const cash: CashFlowTotals = {
    deposits: 0,
    withdrawals: 0,
    invested: 0,
    proceeds: 0,
    dividends: 0,
    fees: 0,
    taxes: 0,
    cash: 0,
  };

  const ensure = (companyId: string, symbol: string): HoldingState => {
    const existing = positions.get(companyId);
    if (existing) return existing;
    const created: HoldingState = {
      companyId,
      symbol,
      quantity: 0,
      costBasis: 0,
      averageCost: 0,
      realisedPnl: 0,
      dividendsReceived: 0,
      feesPaid: 0,
      firstBought: null,
      lastActivity: null,
    };
    positions.set(companyId, created);
    return created;
  };

  for (const entry of [...entries].sort(chronological)) {
    const costs = entry.fees + entry.taxes;
    cash.fees += entry.fees;
    cash.taxes += entry.taxes;

    switch (entry.type) {
      case 'DEPOSIT': {
        cash.deposits += entry.amount ?? 0;
        cash.cash += entry.amount ?? 0;
        break;
      }

      case 'WITHDRAWAL': {
        cash.withdrawals += entry.amount ?? 0;
        cash.cash -= entry.amount ?? 0;
        break;
      }

      case 'BUY': {
        if (!entry.companyId || entry.quantity === null || entry.price === null) break;
        const position = ensure(entry.companyId, entry.symbol ?? '');
        const consideration = entry.quantity * entry.price;
        // Purchase costs are part of what the shares cost you.
        position.costBasis += consideration + costs;
        position.quantity += entry.quantity;
        position.averageCost = position.quantity > 0 ? position.costBasis / position.quantity : 0;
        position.feesPaid += costs;
        position.firstBought ??= entry.tradeDate;
        position.lastActivity = entry.tradeDate;
        cash.invested += consideration + costs;
        cash.cash -= consideration + costs;
        break;
      }

      case 'SELL': {
        if (!entry.companyId || entry.quantity === null || entry.price === null) break;
        const position = ensure(entry.companyId, entry.symbol ?? '');

        if (entry.quantity > position.quantity + EPSILON) {
          // Say so rather than silently clamping: this is almost always a
          // purchase missing from the user's history, and they need to know
          // before they trust the profit figure.
          warnings.push(
            `Sale of ${entry.quantity} ${position.symbol} on ${entry.tradeDate} exceeds the ${round(position.quantity, 4)} shares recorded as held. A purchase may be missing from your transaction history.`,
          );
        }

        const soldQuantity = Math.min(entry.quantity, position.quantity);
        const costOfSold = position.averageCost * soldQuantity;
        const proceeds = entry.quantity * entry.price - costs;

        position.realisedPnl += proceeds - costOfSold;
        position.quantity -= soldQuantity;
        position.costBasis = Math.max(0, position.costBasis - costOfSold);
        // Average cost is unchanged by a sale under this method; recomputing
        // keeps rounding drift from accumulating over many trades.
        position.averageCost = position.quantity > EPSILON ? position.costBasis / position.quantity : 0;
        position.feesPaid += costs;
        position.lastActivity = entry.tradeDate;
        cash.proceeds += proceeds;
        cash.cash += proceeds;
        break;
      }

      case 'DIVIDEND': {
        if (!entry.companyId) break;
        const position = ensure(entry.companyId, entry.symbol ?? '');
        const net = (entry.amount ?? 0) - costs;
        position.dividendsReceived += net;
        position.lastActivity = entry.tradeDate;
        cash.dividends += net;
        cash.cash += net;
        break;
      }
    }
  }

  const all = [...positions.values()];
  return {
    holdings: all.filter((position) => position.quantity > EPSILON),
    closed: all.filter((position) => position.quantity <= EPSILON),
    cash,
    warnings,
  };
}

export interface PriceLookup {
  close: number;
  change: number | null;
  tradeDate: string;
  sector: string | null;
  name: string;
}

export interface ValuedHolding extends HoldingState {
  name: string | null;
  sector: string | null;
  price: number | null;
  priceDate: string | null;
  marketValue: number | null;
  unrealisedPnl: number | null;
  unrealisedPnlPercent: number | null;
  /** Share of the portfolio's equity value. */
  weight: number | null;
  dayChange: number | null;
  /** The price at which this position would break even, costs included. */
  breakEvenPrice: number | null;
  totalReturn: number;
  totalReturnPercent: number | null;
}

export function valueHoldings(
  holdings: HoldingState[],
  prices: Map<string, PriceLookup>,
): ValuedHolding[] {
  const valued: ValuedHolding[] = holdings.map((holding) => {
    const quote = prices.get(holding.companyId);
    const marketValue = quote ? quote.close * holding.quantity : null;
    const unrealisedPnl = marketValue === null ? null : marketValue - holding.costBasis;

    // Everything the position has produced: the gain still on paper, anything
    // already crystallised, and dividends banked along the way.
    const totalReturn = (unrealisedPnl ?? 0) + holding.realisedPnl + holding.dividendsReceived;

    return {
      ...holding,
      name: quote?.name ?? null,
      sector: quote?.sector ?? null,
      price: quote?.close ?? null,
      priceDate: quote?.tradeDate ?? null,
      marketValue,
      unrealisedPnl,
      unrealisedPnlPercent:
        unrealisedPnl === null || holding.costBasis === 0
          ? null
          : (unrealisedPnl / holding.costBasis) * 100,
      weight: null,
      dayChange: quote?.change == null ? null : quote.change * holding.quantity,
      // Dividends already received lower the price you need to get back to even.
      breakEvenPrice:
        holding.quantity > EPSILON
          ? (holding.costBasis - holding.dividendsReceived) / holding.quantity
          : null,
      totalReturn,
      totalReturnPercent: holding.costBasis === 0 ? null : (totalReturn / holding.costBasis) * 100,
    };
  });

  const totalValue = valued.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  for (const holding of valued) {
    holding.weight =
      totalValue > 0 && holding.marketValue !== null
        ? (holding.marketValue / totalValue) * 100
        : null;
  }

  return valued.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
}

export interface PortfolioSummary {
  costBasis: number;
  marketValue: number;
  unrealisedPnl: number;
  unrealisedPnlPercent: number | null;
  realisedPnl: number;
  dividends: number;
  fees: number;
  totalReturn: number;
  totalReturnPercent: number | null;
  netInvested: number;
  cash: number;
  totalPortfolioValue: number;
  dayChange: number;
  dayChangePercent: number | null;
  positions: number;
  /** True when a holding has no price, so the totals understate the position. */
  hasUnpricedHoldings: boolean;
}

export function summarise(
  valued: ValuedHolding[],
  closed: HoldingState[],
  cash: CashFlowTotals,
): PortfolioSummary {
  const costBasis = valued.reduce((sum, holding) => sum + holding.costBasis, 0);
  const marketValue = valued.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const unrealisedPnl = valued.reduce((sum, holding) => sum + (holding.unrealisedPnl ?? 0), 0);
  const realisedPnl = [...valued, ...closed].reduce((sum, holding) => sum + holding.realisedPnl, 0);
  const dividends = [...valued, ...closed].reduce(
    (sum, holding) => sum + holding.dividendsReceived,
    0,
  );
  const dayChange = valued.reduce((sum, holding) => sum + (holding.dayChange ?? 0), 0);

  // Net invested is the money genuinely committed: what was paid for shares,
  // less what selling handed back. Dividends are a return, not a refund.
  const totalReturn = unrealisedPnl + realisedPnl + dividends;

  return {
    costBasis,
    marketValue,
    unrealisedPnl,
    unrealisedPnlPercent: costBasis === 0 ? null : (unrealisedPnl / costBasis) * 100,
    realisedPnl,
    dividends,
    fees: cash.fees + cash.taxes,
    totalReturn,
    totalReturnPercent: cash.invested === 0 ? null : (totalReturn / cash.invested) * 100,
    netInvested: cash.invested - cash.proceeds,
    cash: cash.cash,
    totalPortfolioValue: marketValue + cash.cash,
    dayChange,
    dayChangePercent: pctChange(marketValue - dayChange, marketValue),
    positions: valued.length,
    hasUnpricedHoldings: valued.some((holding) => holding.marketValue === null),
  };
}

export interface AllocationSlice {
  label: string;
  value: number;
  percent: number;
}

export function allocationBy(
  valued: ValuedHolding[],
  key: (holding: ValuedHolding) => string | null,
  fallback = 'Unclassified',
): AllocationSlice[] {
  const totals = new Map<string, number>();
  for (const holding of valued) {
    if (holding.marketValue === null) continue;
    const label = key(holding) ?? fallback;
    totals.set(label, (totals.get(label) ?? 0) + holding.marketValue);
  }

  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value, percent: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}
