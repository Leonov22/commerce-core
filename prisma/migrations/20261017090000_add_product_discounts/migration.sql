-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateTable
CREATE TABLE "product_discounts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_discounts_productId_idx" ON "product_discounts"("productId");

-- CreateIndex
CREATE INDEX "product_discounts_productId_startsAt_endsAt_idx" ON "product_discounts"("productId", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "product_discounts" ADD CONSTRAINT "product_discounts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add nullable first so the backfill below has something to
-- target, then enforce NOT NULL once every existing row has a value.
-- Never touches "unitPriceAmountMinor" — every historical OrderItem's
-- existing charged-price snapshot is untouched by this migration.
ALTER TABLE "order_items" ADD COLUMN "regularUnitPriceAmountMinor" INTEGER;

-- Backfill: no OrderItem created before this migration could have had a
-- discount (ProductDiscount did not exist yet), so its regular price IS
-- exactly its already-recorded charged price.
UPDATE "order_items" SET "regularUnitPriceAmountMinor" = "unitPriceAmountMinor" WHERE "regularUnitPriceAmountMinor" IS NULL;

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "regularUnitPriceAmountMinor" SET NOT NULL;
