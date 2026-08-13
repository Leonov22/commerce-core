"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { AccountField } from "@/modules/identity/components/account-field";

export function AccountLoginForm() {
  const t = useTranslations("Account.login");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasError, setHasError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setHasError(false);
    setIsSubmitting(true);
    try {
      // Auth.js's own Credentials flow — never verifyCredentials() directly.
      const result = await signIn("credentials", { email, password, redirect: false });

      // Auth.js never distinguishes "no such email" from "wrong password"
      // (verifyCredentials() already collapses both into one outcome) — the
      // one generic error here preserves that instead of re-introducing an
      // enumeration signal at the UI layer.
      if (!result || result.error) {
        setHasError(true);
        return;
      }

      router.push("/account");
    } catch {
      setHasError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      {hasError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {t("errors.invalidCredentials")}
        </div>
      ) : null}

      <AccountField
        id="account-login-email"
        label={t("emailLabel")}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={setEmail}
      />
      <AccountField
        id="account-login-password"
        label={t("passwordLabel")}
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={setPassword}
      />

      <Button type="submit" disabled={isSubmitting} className="mt-2 w-full sm:w-auto">
        {isSubmitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
