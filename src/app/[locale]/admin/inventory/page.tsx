import type { Metadata } from "next";
import { listAdminInventory } from "@/modules/catalog";
import { AdminPageHeader, AdminEmptyState } from "@/modules/admin";
import { Link } from "@/core/i18n/navigation";
import { Badge } from "@/shared/components/ui/badge";

export const metadata: Metadata = {
  title: "Inventory — Admin",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 20;

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Inventory list (IMP-048 Increment 4) — mirrors `admin/products/page.tsx`'s
 * own URL-searchParams-driven search/pagination pattern. Every quantity
 * shown here comes straight from `listAdminInventory`, which itself reads
 * `InventoryRepository.getProductAvailability` per product — nothing is
 * recomputed in this page.
 */
export default async function AdminInventoryPage({ searchParams }: Props) {
  const query = await searchParams;
  const search = readParam(query.search);
  const pageParam = Number.parseInt(readParam(query.page) ?? "1", 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const { items, total } = await listAdminInventory({ search, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("page", String(targetPage));
    return `/admin/inventory?${params.toString()}`;
  }

  return (
    <div>
      <AdminPageHeader
        title="Inventory"
        description="Track and adjust stock for every product. Tracking is off by default — enable it per product to start reserving and decrementing stock at checkout."
      />

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="search" className="text-xs font-medium text-muted-foreground">
            Search
          </label>
          <input
            id="search"
            name="search"
            type="text"
            defaultValue={search ?? ""}
            placeholder="Name or slug…"
            className="mt-1 block rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-md border border-border px-4 text-sm hover:bg-accent"
        >
          Apply
        </button>
      </form>

      {items.length === 0 ? (
        <AdminEmptyState
          title="No products found"
          description={search ? "Try adjusting your search." : "Create a product first."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">On-hand</th>
                <th className="px-4 py-3">Reserved</th>
                <th className="px-4 py-3">Available</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.productId}
                  className="border-b border-border last:border-0 hover:bg-accent/40"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/inventory/${item.productId}`} className="hover:underline">
                      {item.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={item.trackInventory ? "positive" : "neutral"}>
                      {item.trackInventory ? "Tracked" : "Not tracked"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{item.stockQuantity}</td>
                  <td className="px-4 py-3 text-muted-foreground">{item.reserved}</td>
                  <td className="px-4 py-3">{item.available ?? "—"}</td>
                  <td className="px-4 py-3">
                    {item.trackInventory && item.lowStock ? (
                      <Badge tone="warning">Low stock</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
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
                href={pageHref(page - 1)}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-accent"
              >
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1)}
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
