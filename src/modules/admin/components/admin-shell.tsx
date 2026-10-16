"use client";

import { useState, type ReactNode } from "react";
import { AdminSidebar } from "@/modules/admin/components/admin-sidebar";
import { AdminHeader } from "@/modules/admin/components/admin-header";
import { cn } from "@/core/lib/utils";

interface AdminShellProps {
  userEmail: string;
  logoutSlot: ReactNode;
  children: ReactNode;
}

/**
 * Reusable Admin Panel chrome (IMP-043): sidebar + header + main content
 * area. Every future admin section (Discounts, Orders, Inventory,
 * Customers, Analytics, Settings) renders its own page content as
 * `children` here — this shell itself never changes to accommodate them,
 * per the architecture requirement that future modules must not require
 * rewriting the admin layout.
 */
export function AdminShell({ userEmail, logoutSlot, children }: AdminShellProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col">
      <AdminHeader
        userEmail={userEmail}
        logoutSlot={logoutSlot}
        onToggleSidebar={() => setIsMobileSidebarOpen((open) => !open)}
      />
      <div className="relative flex flex-1 overflow-hidden">
        <aside
          className={cn(
            "absolute inset-y-0 left-0 z-20 w-64 flex-none border-r border-border bg-background transition-transform lg:static lg:translate-x-0",
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <AdminSidebar />
        </aside>
        {isMobileSidebarOpen ? (
          <button
            type="button"
            aria-label="Close admin navigation"
            className="absolute inset-0 z-10 bg-black/30 lg:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        ) : null}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
