import type { ReactNode } from "react";
import { getCurrentUser, resolveAdminPageRedirect, AccountLogoutButton } from "@/modules/identity";
import { AdminShell } from "@/modules/admin";
import { redirect } from "@/core/i18n/navigation";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

/**
 * Admin Panel root layout (IMP-043). Every page under `/admin/**` shares
 * this one authorization check and this one shell — a future section
 * (Discounts, Orders, Inventory, Customers, Analytics, Settings) only
 * ever needs its own `page.tsx` under this same route group, never a
 * change here.
 *
 * This is the UI-level gate: it decides whether an `/admin` page renders
 * at all. It is not, by itself, the authorization boundary — every admin
 * API route (`api/admin/**`) independently re-checks `isAdminUser` on the
 * session, since a client could call those routes directly without ever
 * loading this layout.
 */
export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  const user = await getCurrentUser();

  const redirectTo = resolveAdminPageRedirect(user);
  if (redirectTo) {
    redirect({
      href: redirectTo === "/account/login" ? `${redirectTo}?callbackUrl=%2Fadmin` : redirectTo,
      locale,
    });
  }

  // Non-null: `resolveAdminPageRedirect` already returned above for a
  // null or non-admin user — by this point `user` is guaranteed an admin.
  return (
    <AdminShell userEmail={user!.email} logoutSlot={<AccountLogoutButton size="sm" />}>
      {children}
    </AdminShell>
  );
}
