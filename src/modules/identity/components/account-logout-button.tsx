"use client";

import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Button, type buttonVariants } from "@/shared/components/ui/button";
import type { VariantProps } from "class-variance-authority";

interface AccountLogoutButtonProps {
  /** IMP-036: lets header/mobile-nav composition request a more compact button than the dashboard's own default, without a second logout implementation. */
  size?: VariantProps<typeof buttonVariants>["size"];
  className?: string;
}

export function AccountLogoutButton({ size, className }: AccountLogoutButtonProps = {}) {
  const t = useTranslations("Account.dashboard");

  return (
    <Button
      variant="outline"
      size={size}
      className={className}
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      {t("logout")}
    </Button>
  );
}
