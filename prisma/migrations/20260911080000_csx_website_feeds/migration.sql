-- DropIndex
DROP INDEX "dividends_company_id_fiscal_year_dividend_type_payment_date_key";

-- DropIndex
DROP INDEX "market_events_company_id_event_date_title_key";

-- AlterTable
ALTER TABLE "dividends" ADD COLUMN     "frequency" TEXT,
ADD COLUMN     "payout_ratio_percent" DECIMAL(10,4),
ADD COLUMN     "source_ref" TEXT,
ADD COLUMN     "total_amount_khr" DECIMAL(24,4);

-- AlterTable
ALTER TABLE "index_quotes" ADD COLUMN     "market_cap_khr" DECIMAL(24,2),
ADD COLUMN     "total_value_khr" DECIMAL(24,2),
ADD COLUMN     "total_volume" BIGINT;

-- AlterTable
ALTER TABLE "market_events" ADD COLUMN     "raw_symbol" TEXT,
ADD COLUMN     "source_ref" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "dividends_source_code_source_ref_key" ON "dividends"("source_code", "source_ref");

-- CreateIndex
CREATE INDEX "market_events_company_id_event_date_idx" ON "market_events"("company_id", "event_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "market_events_source_code_source_ref_key" ON "market_events"("source_code", "source_ref");
