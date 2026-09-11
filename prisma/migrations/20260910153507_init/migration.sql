-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('realtime_api', 'dataset_file', 'publication', 'curated');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('running', 'success', 'partial', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('manual', 'schedule', 'startup');

-- CreateEnum
CREATE TYPE "Board" AS ENUM ('main', 'growth');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('listed', 'suspended', 'delisted');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('month', 'quarter', 'year');

-- CreateEnum
CREATE TYPE "BoardScope" AS ENUM ('main', 'growth', 'all');

-- CreateEnum
CREATE TYPE "FiscalPeriod" AS ENUM ('FY', 'H1', 'Q1', 'Q2', 'Q3', 'Q4');

-- CreateEnum
CREATE TYPE "DividendType" AS ENUM ('cash', 'stock', 'special');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('announcement', 'dividend', 'listing', 'suspension', 'report', 'regulatory');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('KHR', 'USD');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "data_sources" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "homepage_url" TEXT,
    "endpoint_url" TEXT,
    "kind" "SourceKind" NOT NULL,
    "cadence" TEXT,
    "license" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" BIGSERIAL NOT NULL,
    "source_code" TEXT NOT NULL,
    "adapter_key" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'running',
    "trigger" "RunTrigger" NOT NULL DEFAULT 'manual',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "rows_written" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "isin" TEXT,
    "name" TEXT NOT NULL,
    "name_kh" TEXT,
    "legal_name" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "board" "Board" NOT NULL DEFAULT 'main',
    "listing_date" DATE,
    "ipo_price_khr" DECIMAL(18,2),
    "website" TEXT,
    "description" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'listed',
    "source_code" TEXT,
    "source_url" TEXT,
    "source_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_quotes" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "trade_date" DATE NOT NULL,
    "open_khr" DECIMAL(18,2),
    "high_khr" DECIMAL(18,2),
    "low_khr" DECIMAL(18,2),
    "close_khr" DECIMAL(18,2) NOT NULL,
    "change_khr" DECIMAL(18,2),
    "volume" BIGINT,
    "value_khr" DECIMAL(20,2),
    "pe" DECIMAL(14,4),
    "pb" DECIMAL(14,4),
    "dividend_khr" DECIMAL(18,4),
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_code" TEXT NOT NULL,

    CONSTRAINT "stock_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_quotes" (
    "id" BIGSERIAL NOT NULL,
    "index_code" TEXT NOT NULL DEFAULT 'CSX',
    "trade_date" DATE NOT NULL,
    "value" DECIMAL(14,4) NOT NULL,
    "change" DECIMAL(14,4),
    "change_percent" DECIMAL(10,4),
    "open" DECIMAL(14,4),
    "high" DECIMAL(14,4),
    "low" DECIMAL(14,4),
    "index_time" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_code" TEXT NOT NULL,

    CONSTRAINT "index_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" BIGSERIAL NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "rate_date" DATE NOT NULL,
    "bid" DECIMAL(18,4),
    "ask" DECIMAL(18,4),
    "average" DECIMAL(18,4) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_code" TEXT NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_period_stats" (
    "id" BIGSERIAL NOT NULL,
    "board" "BoardScope" NOT NULL DEFAULT 'all',
    "period_type" "PeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "trading_days" INTEGER,
    "listed_companies" INTEGER,
    "listed_shares" DECIMAL(20,2),
    "market_cap_khr" DECIMAL(24,2),
    "trading_volume" DECIMAL(20,2),
    "trading_value_khr" DECIMAL(24,2),
    "daily_avg_volume" DECIMAL(20,2),
    "daily_avg_value_khr" DECIMAL(24,2),
    "buy_order_volume" DECIMAL(20,2),
    "sell_order_volume" DECIMAL(20,2),
    "index_open" DECIMAL(14,4),
    "index_close" DECIMAL(14,4),
    "index_high" DECIMAL(14,4),
    "index_low" DECIMAL(14,4),
    "investor_count" INTEGER,
    "source_code" TEXT NOT NULL,
    "source_dataset_id" TEXT,
    "source_url" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_period_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_period_stats" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "period_type" "PeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "market_cap_khr" DECIMAL(24,2),
    "listed_shares" DECIMAL(20,2),
    "trading_volume" DECIMAL(20,2),
    "trading_value_khr" DECIMAL(24,2),
    "daily_avg_volume" DECIMAL(20,2),
    "daily_avg_value_khr" DECIMAL(24,2),
    "source_code" TEXT NOT NULL,
    "source_dataset_id" TEXT,
    "source_url" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_period_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_statements" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "fiscal_period" "FiscalPeriod" NOT NULL DEFAULT 'FY',
    "period_end" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KHR',
    "revenue" DECIMAL(24,2),
    "gross_profit" DECIMAL(24,2),
    "operating_income" DECIMAL(24,2),
    "net_income" DECIMAL(24,2),
    "total_assets" DECIMAL(24,2),
    "total_liabilities" DECIMAL(24,2),
    "total_equity" DECIMAL(24,2),
    "total_debt" DECIMAL(24,2),
    "cash_and_equivalents" DECIMAL(24,2),
    "operating_cash_flow" DECIMAL(24,2),
    "eps" DECIMAL(18,4),
    "book_value_per_share" DECIMAL(18,4),
    "shares_outstanding" BIGINT,
    "is_audited" BOOLEAN,
    "source_code" TEXT NOT NULL,
    "source_url" TEXT,
    "reported_at" DATE,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividends" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "fiscal_year" INTEGER,
    "dividend_type" "DividendType" NOT NULL DEFAULT 'cash',
    "amount_per_share_khr" DECIMAL(18,4) NOT NULL,
    "ex_date" DATE,
    "record_date" DATE,
    "payment_date" DATE,
    "announcement_date" DATE,
    "source_code" TEXT NOT NULL,
    "source_url" TEXT,
    "note" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dividends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_events" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID,
    "event_date" DATE NOT NULL,
    "event_type" "EventType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "url" TEXT,
    "source_code" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "base_currency" "Currency" NOT NULL DEFAULT 'KHR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "company_id" UUID,
    "type" "TransactionType" NOT NULL,
    "trade_date" DATE NOT NULL,
    "quantity" DECIMAL(20,4),
    "price_khr" DECIMAL(18,4),
    "amount_khr" DECIMAL(20,2),
    "fees_khr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxes_khr" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" UUID NOT NULL,
    "watchlist_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "note" TEXT,
    "target_price_khr" DECIMAL(18,2),
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingestion_runs_source_code_started_at_idx" ON "ingestion_runs"("source_code", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ingestion_runs_adapter_key_started_at_idx" ON "ingestion_runs"("adapter_key", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "companies_symbol_key" ON "companies"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "companies_isin_key" ON "companies"("isin");

-- CreateIndex
CREATE INDEX "companies_board_idx" ON "companies"("board");

-- CreateIndex
CREATE INDEX "companies_sector_idx" ON "companies"("sector");

-- CreateIndex
CREATE INDEX "stock_quotes_company_id_trade_date_idx" ON "stock_quotes"("company_id", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "stock_quotes_trade_date_idx" ON "stock_quotes"("trade_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stock_quotes_company_id_trade_date_key" ON "stock_quotes"("company_id", "trade_date");

-- CreateIndex
CREATE INDEX "index_quotes_index_code_trade_date_idx" ON "index_quotes"("index_code", "trade_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "index_quotes_index_code_trade_date_key" ON "index_quotes"("index_code", "trade_date");

-- CreateIndex
CREATE INDEX "fx_rates_base_currency_quote_currency_rate_date_idx" ON "fx_rates"("base_currency", "quote_currency", "rate_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_base_currency_quote_currency_rate_date_key" ON "fx_rates"("base_currency", "quote_currency", "rate_date");

-- CreateIndex
CREATE INDEX "market_period_stats_period_type_period_start_idx" ON "market_period_stats"("period_type", "period_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "market_period_stats_board_period_type_period_start_key" ON "market_period_stats"("board", "period_type", "period_start");

-- CreateIndex
CREATE INDEX "company_period_stats_company_id_period_type_period_start_idx" ON "company_period_stats"("company_id", "period_type", "period_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "company_period_stats_company_id_period_type_period_start_key" ON "company_period_stats"("company_id", "period_type", "period_start");

-- CreateIndex
CREATE INDEX "financial_statements_company_id_fiscal_year_idx" ON "financial_statements"("company_id", "fiscal_year" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "financial_statements_company_id_fiscal_year_fiscal_period_key" ON "financial_statements"("company_id", "fiscal_year", "fiscal_period");

-- CreateIndex
CREATE INDEX "dividends_company_id_payment_date_idx" ON "dividends"("company_id", "payment_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "dividends_company_id_fiscal_year_dividend_type_payment_date_key" ON "dividends"("company_id", "fiscal_year", "dividend_type", "payment_date");

-- CreateIndex
CREATE INDEX "market_events_event_date_idx" ON "market_events"("event_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "market_events_company_id_event_date_title_key" ON "market_events"("company_id", "event_date", "title");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_expires_at_idx" ON "refresh_tokens"("user_id", "expires_at" DESC);

-- CreateIndex
CREATE INDEX "portfolios_user_id_idx" ON "portfolios"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_user_id_name_key" ON "portfolios"("user_id", "name");

-- CreateIndex
CREATE INDEX "transactions_portfolio_id_trade_date_created_at_idx" ON "transactions"("portfolio_id", "trade_date", "created_at");

-- CreateIndex
CREATE INDEX "transactions_company_id_idx" ON "transactions"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlists_user_id_name_key" ON "watchlists"("user_id", "name");

-- CreateIndex
CREATE INDEX "watchlist_items_watchlist_id_idx" ON "watchlist_items"("watchlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_watchlist_id_company_id_key" ON "watchlist_items"("watchlist_id", "company_id");

-- AddForeignKey
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quotes" ADD CONSTRAINT "stock_quotes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_quotes" ADD CONSTRAINT "stock_quotes_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "index_quotes" ADD CONSTRAINT "index_quotes_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_period_stats" ADD CONSTRAINT "market_period_stats_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_period_stats" ADD CONSTRAINT "company_period_stats_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_period_stats" ADD CONSTRAINT "company_period_stats_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_source_code_fkey" FOREIGN KEY ("source_code") REFERENCES "data_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
