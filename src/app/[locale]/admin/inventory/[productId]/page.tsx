import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminInventoryProduct, listAdminStockHistory } from "@/modules/catalog";
import { getUserById } from "@/modules/identity";
import {
  AdminPageHeader,
  AdminInventoryTrackingForm,
  AdminInventoryAdjustForm,
} from "@/modules/admin";
import { Link } from "@/core/i18n/navigation";
import { Badge } from "@/shared/components/ui/badge";

type Props = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const HISTORY_PAGE_SIZE = 20;

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const product = await getAdminInventoryProduct(productId);
  return { title: product ? `${product.name} — Inventory — Admin` : "Inventory — Admin" };
}

/**
 * Inventory detail page (IMP-048 Increment 4): current availability,
 * the enable/disable-tracking action, the adjust-stock action, and a
 * read-only stock history. Every quantity shown comes straight from
 * `getAdminInventoryProduct` (itself backed by `getProductAvailability`)
 * — nothing here recomputes `reserved`/`available`. History rows are
 * never editable or deletable from this UI: there is no such action
 * wired up, by design (`StockAdjustment` is append-only, see its own
 * schema doc comment).
 */
export default async function AdminInventoryProductPage({ params, searchParams }: Props) {
  const { productId } = await params;
  const query = await searchParams;
  const historyPageParam = Number.parseInt(readParam(query.historyPage) ?? "1", 10);
  const historyPage =
    Number.isInteger(historyPageParam) && historyPageParam > 0 ? historyPageParam : 1;

  const product = await getAdminInventoryProduct(productId);
  if (!product) {
    notFound();
  }

  const history = await listAdminStockHistory({
    filter: { productId },
    page: historyPage,
    pageSize: HISTORY_PAGE_SIZE,
  });

  const uniqueAdminUserIds = Array.from(
    new Set(
      history.items
        .map((item) => item.adminUserId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  const adminUsers = await Promise.all(uniqueAdminUserIds.map((id) => getUserById(id)));
  const adminEmailById = new Map(
    uniqueAdminUserIds.map((id, index) => [id, adminUsers[index]?.email ?? null]),
  );

  const totalHistoryPages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-10">
      <AdminPageHeader
        title={product.name}
        breadcrumbs={[{ label: "Inventory", href: "/admin/inventory" }, { label: product.name }]}
      />

      <section>
        <h2 className="text-base font-medium">Availability</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-border p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tracking
            </dt>
            <dd className="mt-1">
              <Badge tone={product.trackInventory ? "positive" : "neutral"}>
                {product.trackInventory ? "Enabled" : "Disabled"}
              </Badge>
            </dd>
          </div>
          <div className="rounded-lg border border-border p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              On-hand
            </dt>
            <dd className="mt-1 text-lg font-medium">{product.stockQuantity}</dd>
          </div>
          <div className="rounded-lg border border-border p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Reserved
            </dt>
            <dd className="mt-1 text-lg font-medium">{product.reserved}</dd>
          </div>
          <div className="rounded-lg border border-border p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Available
            </dt>
            <dd className="mt-1 text-lg font-medium">{product.available ?? "—"}</dd>
          </div>
        </dl>
        {!product.trackInventory ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Tracking is disabled: checkout never reserves or decrements stock for this product, and
            &ldquo;Available&rdquo; has no meaning until tracking is enabled.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-medium">Tracking</h2>
        <AdminInventoryTrackingForm
          productId={product.productId}
          trackInventory={product.trackInventory}
          stockQuantity={product.stockQuantity}
          reserved={product.reserved}
        />
      </section>

      {product.trackInventory ? (
        <section>
          <AdminInventoryAdjustForm productId={product.productId} />
        </section>
      ) : null}

      <section>
        <h2 className="text-base font-medium">Stock history</h2>
        {history.items.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No stock adjustments yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Change</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Administrator</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(item.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span
                        className={item.quantityChange > 0 ? "text-primary" : "text-destructive"}
                      >
                        {item.quantityChange > 0 ? "+" : ""}
                        {item.quantityChange}
                      </span>
                    </td>
                    <td className="px-4 py-3">{item.reason}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.adminUserId
                        ? (adminEmailById.get(item.adminUserId) ?? "Unknown administrator")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalHistoryPages > 1 ? (
          <nav
            aria-label="Stock history pagination"
            className="mt-4 flex items-center justify-between text-sm"
          >
            <span className="text-muted-foreground">
              Page {historyPage} of {totalHistoryPages} ({history.total} total)
            </span>
            <div className="flex gap-2">
              {historyPage > 1 ? (
                <Link
                  href={`/admin/inventory/${productId}?historyPage=${historyPage - 1}`}
                  className="rounded-md border border-border px-3 py-1.5 hover:bg-accent"
                >
                  Previous
                </Link>
              ) : null}
              {historyPage < totalHistoryPages ? (
                <Link
                  href={`/admin/inventory/${productId}?historyPage=${historyPage + 1}`}
                  className="rounded-md border border-border px-3 py-1.5 hover:bg-accent"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
