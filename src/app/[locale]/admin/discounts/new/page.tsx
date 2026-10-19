import type { Metadata } from "next";
import { listAdminProducts } from "@/modules/catalog";
import { AdminPageHeader, AdminDiscountForm } from "@/modules/admin";

export const metadata: Metadata = {
  title: "New discount — Admin",
};

/** A generous pageSize is fine here — this storefront's catalog is small, and this is a plain product picker, not a paginated list. */
const PRODUCT_PICKER_PAGE_SIZE = 200;

export default async function NewAdminDiscountPage() {
  const { items } = await listAdminProducts({ page: 1, pageSize: PRODUCT_PICKER_PAGE_SIZE });
  const products = items.map((product) => ({ id: product.id, name: product.name }));

  return (
    <div>
      <AdminPageHeader
        title="New discount"
        breadcrumbs={[{ label: "Discounts", href: "/admin/discounts" }, { label: "New" }]}
      />
      <AdminDiscountForm products={products} />
    </div>
  );
}
