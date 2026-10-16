import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/core/i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    // IMP-046: product images are stored in Vercel Blob's public CDN
    // (always this exact hostname pattern for a "public" access-level
    // store), never on local disk — see `product-image-blob-storage.ts`.
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default withNextIntl(nextConfig);
