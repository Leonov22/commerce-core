"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { useRouter } from "@/core/i18n/navigation";
import { Button } from "@/shared/components/ui/button";
import { AccountField } from "@/modules/identity/components/account-field";

type RegisterErrorCode =
  | "INVALID_REQUEST"
  | "PASSWORD_MISMATCH"
  | "INVALID_EMAIL"
  | "WEAK_PASSWORD"
  | "EMAIL_ALREADY_REGISTERED"
  | "INTERNAL_ERROR"
  | "SIGN_IN_FAILED";

const ERROR_MESSAGE_KEYS: Record<RegisterErrorCode, string> = {
  INVALID_REQUEST: "errors.required",
  PASSWORD_MISMATCH: "errors.passwordMismatch",
  INVALID_EMAIL: "errors.invalidEmail",
  WEAK_PASSWORD: "errors.weakPassword",
  EMAIL_ALREADY_REGISTERED: "errors.emailAlreadyRegistered",
  INTERNAL_ERROR: "errors.unexpected",
  SIGN_IN_FAILED: "errors.unexpected",
};

export function AccountRegisterForm() {
  const t = useTranslations("Account.register");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, confirmPassword }),
      });

      if (!response.ok) {
        const data: { error?: RegisterErrorCode } = await response.json().catch(() => ({}));
        const code = data.error && data.error in ERROR_MESSAGE_KEYS ? data.error : "INTERNAL_ERROR";
        setErrorMessage(t(ERROR_MESSAGE_KEYS[code]));
        return;
      }

      // Same Auth.js Credentials flow /account/login uses — no separate
      // registration authentication path.
      const signInResult = await signIn("credentials", { email, password, redirect: false });
      if (!signInResult || signInResult.error) {
        setErrorMessage(t(ERROR_MESSAGE_KEYS.SIGN_IN_FAILED));
        return;
      }

      router.push("/account");
    } catch {
      setErrorMessage(t(ERROR_MESSAGE_KEYS.INTERNAL_ERROR));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {errorMessage}
        </div>
      ) : null}

      <AccountField
        id="account-register-email"
        label={t("emailLabel")}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={setEmail}
      />
      <AccountField
        id="account-register-password"
        label={t("passwordLabel")}
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={setPassword}
      />
      <AccountField
        id="account-register-confirm-password"
        label={t("confirmPasswordLabel")}
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={setConfirmPassword}
      />

      <Button type="submit" disabled={isSubmitting} className="mt-2 w-full sm:w-auto">
        {isSubmitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
