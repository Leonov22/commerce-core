-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_id_idx" ON "orders"("userId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
