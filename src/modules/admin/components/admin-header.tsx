"use client";

import type { ReactNode } from "react";
import { Link } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";

interface AdminHeaderProps {
  userEmail: string;
  /** Composed in by the page/layout, never imported directly — Admin never imports `@/modules/identity` itself, mirroring `site-header.tsx`'s own `accountSlot` pattern. */
  logoutSlot: ReactNode;
  onToggleSidebar: () => void;
}

export function AdminHeader({ userEmail, logoutSlot, onToggleSidebar }: AdminHeaderProps) {
  return (
    <header className="flex h-16 flex-none items-center justify-between border-b border-border px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="lg:hidden"
          aria-label="Toggle admin navigation"
          onClick={onToggleSidebar}
        >
          <span aria-hidden="true">☰</span>
        </Button>
        <Link href="/admin" className="text-base font-semibold tracking-tight">
          Commerce Core — Admin
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">{userEmail}</span>
        {logoutSlot}
      </div>
    </header>
  );
}
