import type { Metadata } from "next";
import { listAdminDiscounts } from "@/modules/catalog";
import { AdminPageHeader, AdminEmptyState } from "@/modules/admin";
import { Link } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { formatProductPrice } from "@/shared/utils/format-price";

export const metadata: Metadata = {
  title: "Discounts — Admin",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 20;

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatValue(type: "PERCENTAGE" | "FIXED_AMOUNT", value: number): string {
  return type === "PERCENTAGE" ? `${value}%` : formatProductPrice(value, "EUR", "en");
}

/**
 * Discount list (IMP-047) — server-rendered pagination, mirroring
 * `admin/products/page.tsx`'s own URL-searchParams-driven pattern.
 */
export default async function AdminDiscountsPage({ searchParams }: Props) {
  const query = await searchParams;
  const pageParam = Number.parseInt(readParam(query.page) ?? "1", 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const { items, total } = await listAdminDiscounts({ page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <AdminPageHeader
        title="Discounts"
        description="Manage product discounts and promotional pricing."
        actions={
          <Link href="/admin/discounts/new">
            <Button type="button">New discount</Button>
          </Link>
        }
      />

      {items.length === 0 ? (
        <AdminEmptyState
          title="No discounts yet"
          description="Create your first discount to get started."
          action={
            <Link href="/admin/discounts/new">
              <Button type="button" size="sm">
                New discount
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Starts</th>
                <th className="px-4 py-3">Ends</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Effective now</th>
              </tr>
            </thead>
            <tbody>
              {items.map((discount) => (
                <tr
                  key={discount.id}
                  className="border-b border-border last:border-0 hover:bg-accent/40"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/discounts/${discount.id}`} className="hover:underline">
                      {discount.productName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {discount.type === "PERCENTAGE" ? "Percentage" : "Fixed amount"}
                  </td>
                  <td className="px-4 py-3">{formatValue(discount.type, discount.value)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(discount.startsAt)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(discount.endsAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={discount.isActive ? "positive" : "neutral"}>
                      {discount.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {discount.isEffectiveNow ? (
                      <Badge tone="positive">Yes</Badge>
                    ) : (
                      <Badge>No</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`/admin/discounts?page=${page - 1}`}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-accent"
              >
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={`/admin/discounts?page=${page + 1}`}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-accent"
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
