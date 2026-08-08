"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "@/core/i18n/navigation";
import { routing } from "@/core/i18n/routing";

const localeLabels: Record<(typeof routing.locales)[number], string> = {
  en: "English",
};

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations("Header");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className={className}>
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={(event) => {
          router.replace(pathname, { locale: event.target.value });
        }}
        className="h-9 rounded-md border border-border bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {routing.locales.map((value) => (
          <option key={value} value={value}>
            {localeLabels[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
