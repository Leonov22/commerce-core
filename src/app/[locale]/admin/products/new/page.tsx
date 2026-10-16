import type { Metadata } from "next";
import { listCategories } from "@/modules/catalog";
import { AdminPageHeader, AdminProductForm } from "@/modules/admin";

export const metadata: Metadata = {
  title: "New product — Admin",
};

export default async function NewAdminProductPage() {
  const categories = await listCategories("en");

  return (
    <div>
      <AdminPageHeader
        title="New product"
        breadcrumbs={[{ label: "Products", href: "/admin/products" }, { label: "New" }]}
      />
      <AdminProductForm categories={categories} />
    </div>
  );
}
