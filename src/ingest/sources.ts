/**
 * The registry of every upstream publisher RielVest reads from.
 *
 * These rows are the backbone of the product's data-transparency promise: every
 * imported figure carries a `source_code` pointing here, so the UI can always
 * name the publisher, link to the dataset and say when it was last refreshed.
 */
export interface SourceDefinition {
  code: string;
  name: string;
  publisher: string;
  homepageUrl: string;
  endpointUrl?: string;
  kind: 'realtime_api' | 'dataset_file' | 'publication' | 'curated';
  cadence: string;
  license?: string;
  description: string;
}

export const SOURCES = {
  CSX_SUMMARY: 'mef.csx_summary',
  CSX_INDEX: 'mef.csx_index',
  CSX_TRADE_CHART: 'csx.trade_chart',
  NBC_FX: 'mef.nbc_exchange_rate',
  MEF_EQUITY_STATS: 'mef.equity_statistics',
  SERC_COMPANY_TRADING: 'mef.serc_company_trading',
  SERC_REPORT: 'serc.market_statistics_report',
  CSX_TRADE_SUMMARY: 'csx.trade_summary',
  CSX_INDEX_HISTORY: 'csx.index_history',
  CSX_DISCLOSURES: 'csx.disclosures',
  RIELVEST_REFERENCE: 'rielvest.reference',
} as const;

export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    code: SOURCES.CSX_TRADE_CHART,
    name: 'CSX Trade Chart Feed',
    publisher: 'Cambodia Securities Exchange (CSX)',
    homepageUrl: 'https://trade.csx.com.kh/',
    endpointUrl: 'https://api.csx.com.kh/tradingview/api/v1',
    kind: 'realtime_api',
    cadence: 'Streaming intraday; historical bars on request',
    license: 'CSX website data and information usage policy',
    description:
      'The chart data used by the official CSX Trade web client. It provides minute, hourly and ' +
      'daily OHLCV bars. RielVest records provenance and does not represent the feed as investment advice.',
  },
  {
    code: SOURCES.CSX_SUMMARY,
    name: 'Cambodia Securities Exchange Summary',
    publisher: 'Cambodia Securities Exchange (CSX), via MEF Open Data Portal',
    homepageUrl: 'https://data.mef.gov.kh/datasets/pd_66a0cd503e0bd300012638fb7',
    endpointUrl: 'https://data.mef.gov.kh/api/v1/realtime-api/csx-summary',
    kind: 'realtime_api',
    cadence: 'Polled periodically; latest trading session only',
    license: 'Cambodia Open Data Portal terms of use',
    description:
      'Official current-session trade summary for every listed equity: open, high, low, close, ' +
      'traded volume and value, plus the P/E and P/B ratios CSX publishes itself. The endpoint ' +
      'returns only the latest session, so RielVest records one snapshot per trading day to build history.',
  },
  {
    code: SOURCES.CSX_INDEX,
    name: 'Cambodia Securities Exchange Index',
    publisher: 'Cambodia Securities Exchange (CSX), via MEF Open Data Portal',
    homepageUrl: 'https://data.mef.gov.kh/datasets/pd_66a0cd503e0bd300012638fb6',
    endpointUrl: 'https://data.mef.gov.kh/api/v1/realtime-api/csx-index',
    kind: 'realtime_api',
    cadence: 'Polled periodically; latest trading session only',
    license: 'Cambodia Open Data Portal terms of use',
    description:
      'The CSX composite index — level, session open, high, low and change against the previous close.',
  },
  {
    code: SOURCES.NBC_FX,
    name: 'Khmer Riel Exchange Rate',
    publisher: 'National Bank of Cambodia (NBC), via MEF Open Data Portal',
    homepageUrl: 'https://data.mef.gov.kh/datasets/pd_66a0cd503e0bd300012638fb4',
    endpointUrl: 'https://data.mef.gov.kh/api/v1/realtime-api/exchange-rate',
    kind: 'realtime_api',
    cadence: 'Daily',
    license: 'Cambodia Open Data Portal terms of use',
    description:
      'NBC official reference rates. RielVest uses the USD/KHR rate only to display riel figures ' +
      'in dollars; every stored amount remains in riel exactly as CSX reports it.',
  },
  {
    code: SOURCES.MEF_EQUITY_STATS,
    name: 'Equity Market Statistics (quarterly)',
    publisher: 'CSX and SERC, via MEF Open Data Portal',
    homepageUrl: 'https://data.mef.gov.kh/datasets?keyword=equity',
    endpointUrl: 'https://data.mef.gov.kh/api/v1/public-datasets',
    kind: 'dataset_file',
    cadence: 'Quarterly',
    license: 'Cambodia Open Data Portal terms of use',
    description:
      'Quarterly market aggregates published as CSV: trading days, listed shares, market ' +
      'capitalisation, traded volume and value, investor counts and the quarter-end CSX index. ' +
      'Coverage runs from 2014 and is the source of RielVest’s long-run market history.',
  },
  {
    code: SOURCES.SERC_COMPANY_TRADING,
    name: 'Per-Company Trading Overview (quarterly)',
    publisher: 'Securities and Exchange Regulator of Cambodia (SERC), via MEF Open Data Portal',
    homepageUrl: 'https://data.mef.gov.kh/datasets?keyword=Trading%20Overview',
    endpointUrl: 'https://data.mef.gov.kh/api/v1/public-datasets',
    kind: 'dataset_file',
    cadence: 'Quarterly',
    license: 'Cambodia Open Data Portal terms of use',
    description:
      'SERC’s quarterly per-issuer figures: reported market capitalisation, traded volume and ' +
      'value. These are reported numbers, not values RielVest calculates from prices.',
  },
  {
    code: SOURCES.SERC_REPORT,
    name: 'Securities Market Statistics Report',
    publisher: 'Securities and Exchange Regulator of Cambodia (SERC)',
    homepageUrl: 'https://data.mef.gov.kh/datasets?keyword=Securities%20Market%20Statistics',
    kind: 'publication',
    cadence: 'Quarterly (PDF)',
    description:
      'SERC’s quarterly PDF report, the authority on board composition, issuance and monthly ' +
      'market statistics. Used as a cross-check on figures shown elsewhere in RielVest.',
  },
  {
    code: SOURCES.CSX_TRADE_SUMMARY,
    name: 'CSX Daily Trade Summary',
    publisher: 'Cambodia Securities Exchange (CSX)',
    homepageUrl: 'https://csx.com.kh/en/market-data/stock/trade-summary',
    endpointUrl: 'https://csx.com.kh/api/v1/website/market-data/stock/trade-summary',
    kind: 'realtime_api',
    cadence: 'Each trading day, after the close',
    description:
      'The exchange’s own end-of-session summary: open, high, low and close, traded volume and ' +
      'value, and the P/E and P/B ratios CSX publishes. This is RielVest’s primary daily price ' +
      'source because it states which session the figures belong to and covers every listed issuer.',
  },
  {
    code: SOURCES.CSX_INDEX_HISTORY,
    name: 'CSX Daily Closing Index (history)',
    publisher: 'Cambodia Securities Exchange (CSX)',
    homepageUrl: 'https://csx.com.kh/en/market-data/index/daily-closing-index',
    endpointUrl: 'https://csx.com.kh/api/v1/website/market-data/index/daily-closing-index/historical-index',
    kind: 'realtime_api',
    cadence: 'Each trading day',
    description:
      'The exchange’s own daily index archive, running back to the first session in April 2012. ' +
      'Each row carries the index level, session open, high and low, together with the exchange-wide ' +
      'market capitalisation and turnover for that day.',
  },
  {
    code: SOURCES.CSX_DISCLOSURES,
    name: 'CSX Listed Company Disclosures',
    publisher: 'Cambodia Securities Exchange (CSX)',
    homepageUrl: 'https://csx.com.kh/en/company-information/stock/listed-companies-announcements',
    endpointUrl: 'https://csx.com.kh/api/v1/website/company/stock/list-companies-announcements',
    kind: 'realtime_api',
    cadence: 'As issuers disclose',
    description:
      'Every disclosure CSX has published for listed issuers — quarterly and annual reports, ' +
      'dividend declarations, governance notices and corporate actions. Dividend declarations are ' +
      'filed in a structured form, which is where RielVest’s dividend history comes from.',
  },
  {
    code: SOURCES.RIELVEST_REFERENCE,
    name: 'RielVest Reference Data',
    publisher: 'RielVest (compiled from public listing records)',
    homepageUrl: 'https://data.mef.gov.kh/',
    kind: 'curated',
    cadence: 'Reviewed on release',
    description:
      'Descriptive company facts that no machine-readable Cambodian source publishes: legal name, ' +
      'sector, board and listing date. Each entry cites where it came from. RielVest never stores ' +
      'a financial figure here — only what a company is.',
  },
];
