/**
 * Seeds the Catalog database with the six products and four categories that
 * previously lived in `catalog-data.ts` / `en.json`, preserving their
 * existing IDs, slugs, and English content exactly.
 *
 * Run with: pnpm exec tsx prisma/seed.ts
 * (tsx resolves the generated client's extensionless internal imports the
 * same way Next.js's bundler does; plain `node` cannot.)
 *
 * CR-037-01-SEED: this script performs BROAD upserts — it can overwrite
 * an EXISTING product's price, status, category, badge, sort order,
 * slug, publication date, and every translation field. It is
 * development/test fixture data only, and running it against a shared
 * or production database would silently clobber real catalog content.
 * `assertBroadSeedIsConfirmed` below therefore refuses to proceed
 * (before any Prisma client is even constructed, let alone any query
 * runs) unless `SEED_ALLOW_BROAD_WRITE` is explicitly set to the exact
 * confirmation value — see `isBroadSeedConfirmed`'s own doc comment for
 * why this is deliberately not based on `NODE_ENV`. To populate
 * `Product.isFeatured` on an existing (e.g. production) catalog without
 * this risk, use `prisma/set-featured-products.ts` instead, which
 * cannot overwrite anything else.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, ProductStatus, ProductBadge } from "@/generated/prisma/client";
import {
  isBroadSeedConfirmed,
  SEED_CONFIRMATION_ENV_VAR,
  SEED_CONFIRMATION_VALUE,
} from "@/modules/catalog/infrastructure/seed-guard";

function assertBroadSeedIsConfirmed(): void {
  if (isBroadSeedConfirmed(process.env)) {
    return;
  }
  console.error(
    "[prisma/seed.ts] Refused: this script performs BROAD upserts that can " +
      "overwrite existing product/category data — price, status, category, " +
      "badge, sort order, slug, publication date, and every translation " +
      "field. It is development/test fixture data only and must never run " +
      "against a shared or production database.\n\n" +
      "To confirm the connected database is a development/test database " +
      "and proceed anyway, set:\n" +
      `  ${SEED_CONFIRMATION_ENV_VAR}=${SEED_CONFIRMATION_VALUE}\n\n` +
      "in the environment before running this script.\n\n" +
      "To populate Product.isFeatured on an existing catalog (including " +
      "production) instead, run prisma/set-featured-products.ts, which " +
      "cannot overwrite anything else.",
  );
  process.exit(1);
}

assertBroadSeedIsConfirmed();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const categories = [
  { slug: "seating", sortOrder: 0, name: "Seating" },
  { slug: "lighting", sortOrder: 1, name: "Lighting" },
  { slug: "textiles", sortOrder: 2, name: "Textiles" },
  { slug: "decor", sortOrder: 3, name: "Decor" },
] as const;

const products = [
  {
    id: "1",
    slug: "studio-chair",
    categorySlug: "seating",
    badge: ProductBadge.NEW,
    priceAmountMinor: 24000,
    sortOrder: 0,
    isFeatured: true,
    name: "Studio Chair",
    meta: "Oak & linen",
    description:
      "A considered studio chair in solid oak with a natural linen seat — designed to feel equally at home in a living room or a studio corner.",
    material: "Solid oak, linen upholstery",
    dimensions: "58 × 60 × 78 cm",
  },
  {
    id: "2",
    slug: "lounge-chair",
    categorySlug: "seating",
    badge: null,
    priceAmountMinor: 31000,
    sortOrder: 1,
    isFeatured: false,
    name: "Lounge Chair",
    meta: "Bouclé & ash",
    description:
      "A low, relaxed lounge chair upholstered in bouclé with a solid ash frame — built for slow afternoons.",
    material: "Ash frame, bouclé upholstery",
    dimensions: "72 × 78 × 74 cm",
  },
  {
    id: "3",
    slug: "table-lamp",
    categorySlug: "lighting",
    badge: ProductBadge.LIMITED,
    priceAmountMinor: 9600,
    sortOrder: 2,
    isFeatured: true,
    name: "Table Lamp",
    meta: "Brushed brass",
    description:
      "A compact table lamp in brushed brass with a soft, warm glow — a quiet detail for a desk or side table.",
    material: "Brushed brass",
    dimensions: "18 × 18 × 34 cm",
  },
  {
    id: "4",
    slug: "pendant-light",
    categorySlug: "lighting",
    badge: null,
    priceAmountMinor: 14500,
    sortOrder: 3,
    isFeatured: false,
    name: "Pendant Light",
    meta: "Opal glass",
    description:
      "An opal glass pendant light that diffuses a soft, even light — a calm centerpiece for a dining table or entryway.",
    material: "Opal glass, brass fitting",
    dimensions: "Ø 24 × 22 cm",
  },
  {
    id: "5",
    slug: "wool-throw",
    categorySlug: "textiles",
    badge: null,
    priceAmountMinor: 12800,
    sortOrder: 4,
    isFeatured: true,
    name: "Wool Throw",
    meta: "Undyed merino wool",
    description:
      "An undyed merino wool throw, kept soft and breathable through a simple, natural finishing process.",
    material: "100% merino wool",
    dimensions: "130 × 180 cm",
  },
  {
    id: "6",
    slug: "ceramic-vase",
    categorySlug: "decor",
    badge: null,
    priceAmountMinor: 8600,
    sortOrder: 5,
    isFeatured: true,
    name: "Ceramic Vase",
    meta: "Handmade ceramic",
    description:
      "A handmade ceramic vase with a subtly uneven glaze — no two pieces are exactly alike.",
    material: "Glazed stoneware",
    dimensions: "Ø 16 × 28 cm",
  },
] as const;

async function main() {
  console.log("Seeding categories...");
  const categoryIdBySlug = new Map<string, string>();

  for (const category of categories) {
    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { sortOrder: category.sortOrder },
      create: { slug: category.slug, sortOrder: category.sortOrder },
    });
    categoryIdBySlug.set(category.slug, record.id);

    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: record.id, locale: "en" } },
      update: { name: category.name },
      create: { categoryId: record.id, locale: "en", name: category.name },
    });
  }

  console.log("Seeding products...");
  for (const product of products) {
    const categoryId = categoryIdBySlug.get(product.categorySlug);
    if (!categoryId) {
      throw new Error(`Unknown category slug "${product.categorySlug}" for product ${product.id}`);
    }

    await prisma.product.upsert({
      where: { id: product.id },
      update: {
        slug: product.slug,
        status: ProductStatus.ACTIVE,
        priceAmountMinor: product.priceAmountMinor,
        currency: "USD",
        categoryId,
        badge: product.badge,
        sortOrder: product.sortOrder,
        isFeatured: product.isFeatured,
        publishedAt: new Date(),
      },
      create: {
        id: product.id,
        slug: product.slug,
        status: ProductStatus.ACTIVE,
        priceAmountMinor: product.priceAmountMinor,
        currency: "USD",
        categoryId,
        badge: product.badge,
        sortOrder: product.sortOrder,
        isFeatured: product.isFeatured,
        publishedAt: new Date(),
      },
    });

    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale: "en" } },
      update: {
        name: product.name,
        meta: product.meta,
        description: product.description,
        material: product.material,
        dimensions: product.dimensions,
      },
      create: {
        productId: product.id,
        locale: "en",
        name: product.name,
        meta: product.meta,
        description: product.description,
        material: product.material,
        dimensions: product.dimensions,
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
