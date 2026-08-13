"use client";

import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { Button } from "@/shared/components/ui/button";

export function AccountLogoutButton() {
  const t = useTranslations("Account.dashboard");

  return (
    <Button variant="outline" onClick={() => signOut({ callbackUrl: "/" })}>
      {t("logout")}
    </Button>
  );
}
