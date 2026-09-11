-- CreateTable
CREATE TABLE "ai_narratives" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL,
    "trade_date" DATE NOT NULL,
    "language" TEXT NOT NULL,
    "lines" TEXT[],
    "source" TEXT NOT NULL,
    "model" TEXT,
    "fallback_reason" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_narratives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_narratives_company_id_trade_date_idx" ON "ai_narratives"("company_id", "trade_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_narratives_company_id_trade_date_language_key" ON "ai_narratives"("company_id", "trade_date", "language");

-- AddForeignKey
ALTER TABLE "ai_narratives" ADD CONSTRAINT "ai_narratives_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
