# RielVest market data plan

## What ships now

RielVest reads the latest CSX equity and index session from the MEF Open Data
Portal. It also reads the public chart feed used by `trade.csx.com.kh`, which
provides minute, hourly and daily OHLCV history. The first backfill imported
17,164 historical daily bars across 12 listed companies.

The stock page requests current chart bars through the RielVest API and refreshes
them every 30 seconds. It can display either candles or a closing-price line for
1-minute, 5-minute, 15-minute, hourly, daily, weekly and monthly intervals. The
5-minute, 15-minute, weekly and monthly bars are calculated from official source
bars; no prices are synthesized.

## Feed mechanics

The CSX web chart exposes REST history endpoints for minute, hourly and daily
bars. Its browser client also subscribes to a CSX WebSocket for live trades.
RielVest currently polls the REST bars every 30 seconds, which is near-real-time
rather than tick-by-tick streaming. A later iteration can proxy the WebSocket
through the backend if sub-second updates become useful.

The analysis API recalculates from the latest stored market data on every request.
The frontend caches that result for at most 60 seconds. Daily ingestion updates
the current OHLC, ratios and turnover; the next analysis request then uses the
new session together with the imported history.

## Historical backfill operation

Run:

```sh
npm run ingest -- csx-chart-history
```

The importer uses `createMany(..., skipDuplicates: true)`, so it adds missing
daily history without replacing the richer current MEF row containing P/E and
P/B. It is safe to rerun when a new issuer appears.

Before a public or commercial launch, review the CSX data-use policy and obtain
written redistribution permission. The public endpoints are technically
accessible, but technical access and redistribution rights are separate issues.

## Future intraday schema

Keep immutable executions separately from derived bars:

- `market_trades`: company, execution timestamp, price, quantity, trade ID and
  source.
- `intraday_bars`: company, interval, start time, open, high, low, close, volume,
  value and source.
- Unique bar key: `(company_id, interval, start_time)`.
- Store upstream timestamps in UTC and render them in Asia/Phnom_Penh.

Bars should be derived from licensed executions when possible. If a provider
supplies bars directly, retain the provider's source and retrieval metadata so
the UI can distinguish reported from calculated values.

## Official references

- MEF Open Data Portal: https://data.mef.gov.kh/
- CSX market website: https://csx.com.kh/home.jsp
- CSX data-use policy: https://csx.com.kh/en/diclamer/index_pop.jsp
- ACLEDA Securities market-information guide:
  https://www.acledasecurities.com.kh/as/eng/tradingrule
