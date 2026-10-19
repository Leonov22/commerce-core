-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "InventoryExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable: both columns carry a DEFAULT, so every existing row is
-- populated in the same statement, with no separate backfill step —
-- every existing product becomes trackInventory=false, stockQuantity=0.
ALTER TABLE "products" ADD COLUMN     "trackInventory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stockQuantity" INTEGER NOT NULL DEFAULT 0;

-- AddCheckConstraint: not representable in Prisma's schema DSL, added
-- by hand. Every existing row's new "stockQuantity" is exactly 0 (the
-- column's own DEFAULT, applied in the same statement above), which
-- trivially satisfies this — there is no existing value this could
-- ever conflict with.
ALTER TABLE "products" ADD CONSTRAINT "products_stockQuantity_check" CHECK ("stockQuantity" >= 0);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint: new table, no existing rows — cannot conflict
-- with any existing data. Not representable in Prisma's schema DSL.
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_check" CHECK ("quantity" > 0);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "adminUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint: new table, no existing rows. A zero-quantity
-- adjustment is a meaningless no-op that shouldn't be recordable at
-- all. Not representable in Prisma's schema DSL.
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_quantityChange_check" CHECK ("quantityChange" != 0);

-- CreateTable
CREATE TABLE "inventory_exceptions" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "paymentId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "InventoryExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByAdminUserId" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "inventory_exceptions_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint: new table, no existing rows. This is the quantity
-- of a reservation that could not be consumed, so zero or negative
-- values are invalid. Not representable in Prisma's schema DSL.
ALTER TABLE "inventory_exceptions" ADD CONSTRAINT "inventory_exceptions_quantity_check" CHECK ("quantity" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_orderId_productId_key" ON "stock_reservations"("orderId", "productId");

-- CreateIndex
CREATE INDEX "stock_reservations_productId_status_idx" ON "stock_reservations"("productId", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_status_expiresAt_idx" ON "stock_reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "stock_adjustments_productId_createdAt_idx" ON "stock_adjustments"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_exceptions_reservationId_key" ON "inventory_exceptions"("reservationId");

-- CreateIndex
CREATE INDEX "inventory_exceptions_status_idx" ON "inventory_exceptions"("status");

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_exceptions" ADD CONSTRAINT "inventory_exceptions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "stock_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
