import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminProduct, listCategories } from "@/modules/catalog";
import { AdminPageHeader, AdminProductForm } from "@/modules/admin";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = await getAdminProduct(id);
  return { title: product ? `${product.name} — Admin` : "Product — Admin" };
}

export default async function EditAdminProductPage({ params }: Props) {
  const { id } = await params;
  const [product, categories] = await Promise.all([getAdminProduct(id), listCategories("en")]);

  if (!product) {
    notFound();
  }

  return (
    <div>
      <AdminPageHeader
        title={product.name}
        breadcrumbs={[{ label: "Products", href: "/admin/products" }, { label: product.name }]}
      />
      <AdminProductForm initialProduct={product} categories={categories} />
    </div>
  );
}
