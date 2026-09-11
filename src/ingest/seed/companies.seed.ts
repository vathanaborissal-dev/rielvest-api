/**
 * Curated reference facts for the CSX-listed equities.
 *
 * Cambodia publishes no machine-readable company register, so these descriptive
 * fields are compiled by hand from public listing records and reviewed against
 * SERC's quarterly report. Deliberately absent: anything financial. Share
 * counts, IPO prices and fundamentals are left null rather than estimated —
 * RielVest shows "not available" instead of a number it cannot stand behind.
 *
 * Board assignments cross-check against SERC's Securities Market Statistics
 * Report Q2 2026, which counts 9 Main Board and 3 Growth Board issuers.
 */
export interface CompanySeed {
  symbol: string;
  name: string;
  legalName: string;
  sector: string;
  industry: string;
  board: 'main' | 'growth';
  listingDate: string;
  website?: string;
  description: string;
}

export const COMPANY_SEEDS: CompanySeed[] = [
  {
    symbol: 'PWSA',
    name: 'Phnom Penh Water Supply Authority',
    legalName: 'Phnom Penh Water Supply Authority',
    sector: 'Utilities',
    industry: 'Water Utilities',
    board: 'main',
    listingDate: '2012-04-18',
    website: 'https://www.ppwsa.com.kh',
    description:
      'The municipal water utility for Phnom Penh, treating and distributing potable water across ' +
      'the capital. It was the first company to list on the Cambodia Securities Exchange.',
  },
  {
    symbol: 'GTI',
    name: 'Grand Twins International',
    legalName: 'Grand Twins International (Cambodia) Plc.',
    sector: 'Consumer Goods',
    industry: 'Apparel Manufacturing',
    board: 'main',
    listingDate: '2014-06-16',
    description:
      'A garment manufacturer producing apparel for international brands from factories in ' +
      'Cambodia. It was the first foreign-owned company to list on the exchange.',
  },
  {
    symbol: 'PPAP',
    name: 'Phnom Penh Autonomous Port',
    legalName: 'Phnom Penh Autonomous Port',
    sector: 'Industrials',
    industry: 'Ports & Logistics',
    board: 'main',
    listingDate: '2015-12-09',
    website: 'https://www.ppap.com.kh',
    description:
      'Operator of Cambodia’s inland river port on the Mekong, handling container and bulk cargo ' +
      'between Phnom Penh and the sea, together with associated logistics and property assets.',
  },
  {
    symbol: 'PPSP',
    name: 'Phnom Penh SEZ',
    legalName: 'Phnom Penh SEZ Plc.',
    sector: 'Real Estate',
    industry: 'Industrial Real Estate',
    board: 'main',
    listingDate: '2016-05-30',
    website: 'https://www.ppsez.com',
    description:
      'Developer and operator of special economic zones, leasing serviced industrial land and ' +
      'facilities to manufacturers and providing zone infrastructure and services.',
  },
  {
    symbol: 'PAS',
    name: 'Sihanoukville Autonomous Port',
    legalName: 'Sihanoukville Autonomous Port',
    sector: 'Industrials',
    industry: 'Ports & Logistics',
    board: 'main',
    listingDate: '2017-06-08',
    website: 'https://www.pas.gov.kh',
    description:
      'Cambodia’s only deep-sea port, handling the majority of the country’s container traffic ' +
      'and serving as the primary gateway for seaborne trade.',
  },
  {
    symbol: 'ABC',
    name: 'ACLEDA Bank',
    legalName: 'ACLEDA Bank Plc.',
    sector: 'Financials',
    industry: 'Commercial Banking',
    board: 'main',
    listingDate: '2020-05-25',
    website: 'https://www.acledabank.com.kh',
    description:
      'One of Cambodia’s largest commercial banks by assets and branch network, offering retail, ' +
      'SME and corporate banking. Its listing remains the largest IPO on the exchange.',
  },
  {
    symbol: 'PEPC',
    name: 'Pestech (Cambodia)',
    legalName: 'Pestech (Cambodia) Plc.',
    sector: 'Utilities',
    industry: 'Power Infrastructure',
    board: 'main',
    listingDate: '2020-08-12',
    description:
      'An electrical power infrastructure company building and operating transmission and ' +
      'substation assets in Cambodia, including concession-based projects.',
  },
  {
    symbol: 'DBDE',
    name: 'DBD Engineering',
    legalName: 'DBD Engineering Plc.',
    sector: 'Industrials',
    industry: 'Engineering & Construction',
    board: 'growth',
    listingDate: '2021-09-06',
    description:
      'A water and civil engineering contractor delivering treatment plants and distribution ' +
      'infrastructure. It was the first company to list on the CSX Growth Board for SMEs.',
  },
  {
    symbol: 'JSL',
    name: 'JS Land',
    legalName: 'JS Land Plc.',
    sector: 'Real Estate',
    industry: 'Property Development',
    board: 'growth',
    listingDate: '2022-02-10',
    description:
      'A property developer focused on residential land and housing projects, and the second ' +
      'company to list on the CSX Growth Board.',
  },
  {
    symbol: 'CGSM',
    name: 'CAMGSM (Cellcard)',
    legalName: 'CAMGSM Plc.',
    sector: 'Telecommunications',
    industry: 'Mobile Network Operator',
    board: 'main',
    listingDate: '2023-06-27',
    website: 'https://www.cellcard.com.kh',
    description:
      'Cambodia’s domestically owned mobile network operator, trading as Cellcard, providing ' +
      'mobile voice, data and digital services nationwide.',
  },
  {
    symbol: 'MJQE',
    name: 'Mengly J. Quach Education',
    legalName: 'Mengly J. Quach Education Plc.',
    sector: 'Consumer Services',
    industry: 'Private Education',
    board: 'main',
    listingDate: '2023-06-28',
    website: 'https://www.mjqeducation.edu.kh',
    description:
      'An operator of private schools, language centres and related education services across ' +
      'Cambodia, spanning pre-school through secondary education.',
  },
  {
    symbol: 'PCG',
    name: 'Picasso City Garden Development',
    legalName: 'Picasso City Garden Development Plc.',
    sector: 'Real Estate',
    industry: 'Property Development',
    board: 'growth',
    listingDate: '2025-12-10',
    description:
      'A property developer listed on the CSX Growth Board. RielVest’s market-data feed does not ' +
      'yet return quotes for this issuer, so no price or trading figures are shown for it.',
  },
];

export const COMPANY_SEED_SOURCE_URL = 'https://data.mef.gov.kh/datasets?keyword=equity';
export const COMPANY_SEED_NOTE =
  'Descriptive facts compiled from public CSX listing records; board assignment cross-checked ' +
  'against SERC Securities Market Statistics Report (9 Main Board, 3 Growth Board issuers). ' +
  'No financial figure is sourced from this record.';
