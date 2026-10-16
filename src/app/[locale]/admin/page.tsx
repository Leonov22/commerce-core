import type { Metadata } from "next";
import { listAdminProducts, listCategories } from "@/modules/catalog";
import { AdminPageHeader } from "@/modules/admin";

export const metadata: Metadata = {
  title: "Dashboard — Admin",
};

/**
 * Admin dashboard foundation (IMP-043). Only real, already-available data
 * is shown: product and category counts, both already served by Catalog
 * for other reasons. Orders/Customers/Analytics metrics are intentionally
 * omitted rather than fabricated or backed by a new model built solely to
 * populate a card — those become real once the Orders/Customers/Analytics
 * sections themselves exist.
 */
export default async function AdminDashboardPage() {
  const [productPage, categories] = await Promise.all([
    listAdminProducts({ page: 1, pageSize: 1 }),
    listCategories("en"),
  ]);

  const activeCount = (
    await listAdminProducts({ filter: { status: "ACTIVE" }, page: 1, pageSize: 1 })
  ).total;
  const draftCount = (
    await listAdminProducts({ filter: { status: "DRAFT" }, page: 1, pageSize: 1 })
  ).total;

  return (
    <div>
      <AdminPageHeader title="Dashboard" description="An overview of your catalog." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardCard label="Total products" value={productPage.total} />
        <DashboardCard label="Active" value={activeCount} />
        <DashboardCard label="Draft" value={draftCount} />
        <DashboardCard label="Categories" value={categories.length} />
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Orders, customer, and sales metrics will appear here once those sections are implemented.
      </p>
    </div>
  );
}

function DashboardCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
