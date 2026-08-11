-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "subtotalAmountMinor" INTEGER NOT NULL,
    "deliveryAmountMinor" INTEGER NOT NULL,
    "totalAmountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unitPriceAmountMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalAmountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint: money amounts must never be negative.
-- ("At least one OrderItem per Order" is a cross-row rule that a per-row
-- CHECK cannot express in Postgres without triggers; per IMP-025 it is
-- deferred to the future Order-creation application layer instead.)
ALTER TABLE "orders" ADD CONSTRAINT "orders_subtotal_non_negative" CHECK ("subtotalAmountMinor" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_non_negative" CHECK ("deliveryAmountMinor" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_non_negative" CHECK ("totalAmountMinor" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_price_non_negative" CHECK ("unitPriceAmountMinor" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_total_non_negative" CHECK ("lineTotalAmountMinor" >= 0);

-- CheckConstraint: an order line must represent at least one unit.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_at_least_one" CHECK ("quantity" >= 1);
