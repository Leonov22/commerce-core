import type { Metadata } from "next";
import { listCategories } from "@/modules/catalog";
import { AdminPageHeader, AdminEmptyState, AdminCategoryCreateForm } from "@/modules/admin";

export const metadata: Metadata = {
  title: "Categories — Admin",
};

/**
 * Category management (IMP-043) — deliberately minimal (list + create
 * only). See `admin-category-commands.ts`'s own doc comment for why
 * editing/deleting isn't in this milestone's scope.
 */
export default async function AdminCategoriesPage() {
  const categories = await listCategories("en");

  return (
    <div>
      <AdminPageHeader title="Categories" description="Organize products into categories." />

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          {categories.length === 0 ? (
            <AdminEmptyState
              title="No categories yet"
              description="Create your first category to get started."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Slug</th>
                    <th className="px-4 py-3">Sort order</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{category.translation.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{category.slug}</td>
                      <td className="px-4 py-3 text-muted-foreground">{category.sortOrder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <AdminCategoryCreateForm />
      </div>
    </div>
  );
}
