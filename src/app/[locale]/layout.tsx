import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { Geist, Geist_Mono } from "next/font/google";
import { routing } from "@/core/i18n/routing";
import { SiteHeader } from "@/shared/components/layout/site-header";
import { SiteFooter } from "@/shared/components/layout/site-footer";
import { CartProvider, CartNavLink } from "@/modules/cart";
import { getCurrentUser, AccountLogoutButton } from "@/modules/identity";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Commerce Core",
  description: "Commerce Core — a configurable eCommerce platform.",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = LayoutProps<"/[locale]">;

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // IMP-036: resolved once, server-side, through Identity's own public
  // boundary — `shared/components/layout/site-header.tsx` never imports
  // `@/modules/identity` itself, exactly as it never imports
  // `@/modules/cart` for the cart entry point below.
  const user = await getCurrentUser();
  const isAuthenticated = Boolean(user);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <CartProvider>
            <SiteHeader
              cartSlot={<CartNavLink />}
              accountSlot={isAuthenticated ? <AccountLogoutButton size="sm" /> : null}
              isAuthenticated={isAuthenticated}
            />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </CartProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
