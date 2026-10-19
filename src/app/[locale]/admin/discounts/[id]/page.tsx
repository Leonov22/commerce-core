import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminDiscount, listAdminProducts } from "@/modules/catalog";
import { AdminPageHeader, AdminDiscountForm } from "@/modules/admin";

type Props = { params: Promise<{ id: string }> };

const PRODUCT_PICKER_PAGE_SIZE = 200;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const discount = await getAdminDiscount(id);
  return { title: discount ? `Discount — Admin` : "Discount — Admin" };
}

export default async function EditAdminDiscountPage({ params }: Props) {
  const { id } = await params;
  const [discount, { items }] = await Promise.all([
    getAdminDiscount(id),
    listAdminProducts({ page: 1, pageSize: PRODUCT_PICKER_PAGE_SIZE }),
  ]);

  if (!discount) {
    notFound();
  }

  const products = items.map((product) => ({ id: product.id, name: product.name }));
  const productName =
    products.find((product) => product.id === discount.productId)?.name ?? discount.productId;

  return (
    <div>
      <AdminPageHeader
        title={`Discount — ${productName}`}
        breadcrumbs={[{ label: "Discounts", href: "/admin/discounts" }, { label: productName }]}
      />
      <AdminDiscountForm initialDiscount={discount} products={products} />
    </div>
  );
}
