/**
 * Public entry point for the Admin Panel's presentation layer (IMP-043).
 * Pure UI — no domain logic, no Prisma, no authorization decisions. Admin
 * pages compose these pieces together with whichever business module
 * (Catalog today; Order/Payment/Inventory in future milestones) they
 * actually need, exactly the way `[locale]/layout.tsx` composes the
 * storefront header from Cart/Identity.
 */
export { AdminShell } from "@/modules/admin/components/admin-shell";
export { AdminPageHeader } from "@/modules/admin/components/admin-page-header";
export {
  AdminLoadingState,
  AdminEmptyState,
  AdminErrorState,
} from "@/modules/admin/components/admin-states";
export { AdminProductForm } from "@/modules/admin/components/admin-product-form";
export { AdminCategoryCreateForm } from "@/modules/admin/components/admin-category-create-form";
