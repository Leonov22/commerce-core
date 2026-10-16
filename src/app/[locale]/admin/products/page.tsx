import type { Metadata } from "next";
import { listAdminProducts, listCategories } from "@/modules/catalog";
import type { ProductStatus } from "@/modules/catalog";
import { AdminPageHeader, AdminEmptyState } from "@/modules/admin";
import { Link } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { formatProductPrice } from "@/shared/utils/format-price";

export const metadata: Metadata = {
  title: "Products — Admin",
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE = 20;

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function statusTone(status: ProductStatus): "positive" | "neutral" | "warning" {
  if (status === "ACTIVE") return "positive";
  if (status === "ARCHIVED") return "neutral";
  return "warning";
}

/**
 * Product list (IMP-043) — server-rendered, search/filter/pagination
 * driven entirely by URL search params (the same pattern
 * `account/orders/page.tsx` already uses for cursor pagination), so every
 * state is a plain, shareable, bookmarkable, back-button-safe link rather
 * than client-only component state. No JavaScript is required for the
 * search/filter/pagination controls to work.
 */
export default async function AdminProductsPage({ searchParams }: Props) {
  const query = await searchParams;
  const search = readParam(query.search);
  const statusParam = readParam(query.status);
  const status =
    statusParam === "DRAFT" || statusParam === "ACTIVE" || statusParam === "ARCHIVED"
      ? statusParam
      : undefined;
  const categoryId = readParam(query.categoryId);
  const pageParam = Number.parseInt(readParam(query.page) ?? "1", 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const [{ items, total }, categories] = await Promise.all([
    listAdminProducts({
      filter: {
        ...(status ? { status } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(search ? { search } : {}),
      },
      page,
      pageSize: PAGE_SIZE,
    }),
    listCategories("en"),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    params.set("page", String(targetPage));
    return `/admin/products?${params.toString()}`;
  }

  return (
    <div>
      <AdminPageHeader
        title="Products"
        description="Manage your catalog's products."
        actions={
          <Link href="/admin/products/new">
            <Button type="button">New product</Button>
          </Link>
        }
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
        <div>
          <label htmlFor="status" className="text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 block rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div>
          <label htmlFor="categoryId" className="text-xs font-medium text-muted-foreground">
            Category
          </label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={categoryId ?? ""}
            className="mt-1 block rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.translation.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
      </form>

      {items.length === 0 ? (
        <AdminEmptyState
          title="No products found"
          description={
            search || status || categoryId
              ? "Try adjusting your search or filters."
              : "Create your first product to get started."
          }
          action={
            !search && !status && !categoryId ? (
              <Link href="/admin/products/new">
                <Button type="button" size="sm">
                  New product
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => (
                <tr
                  key={product.id}
                  className="border-b border-border last:border-0 hover:bg-accent/40"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/products/${product.id}`} className="hover:underline">
                      {product.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{product.slug}</td>
                  <td className="px-4 py-3">
                    {formatProductPrice(product.priceAmountMinor, product.currency, "en")}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(product.status)}>{product.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{product.categoryName}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                      product.updatedAt,
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
