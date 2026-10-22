import { describe, expect, it } from "vitest";
import {
  listAdminInventory,
  getAdminInventoryProduct,
  listAdminStockHistory,
} from "@/modules/catalog/application/admin-inventory-queries";
import type {
  ProductRepository,
  AdminProductListOptions,
  AdminProductListPage,
} from "@/modules/catalog/repositories/product-repository";
import type {
  InventoryRepository,
  StockAdjustmentListPage,
} from "@/modules/catalog/repositories/inventory-repository";
import type { AdminProduct, AdminProductListItem } from "@/modules/catalog/domain/admin-product";
import type { ProductAvailability } from "@/modules/catalog/domain/inventory";

function makeAdminProduct(overrides: Partial<AdminProduct> = {}): AdminProduct {
  const now = new Date();
  return {
    id: "product-1",
    slug: "studio-chair",
    status: "ACTIVE",
    priceAmountMinor: 10000,
    currency: "EUR",
    categoryId: "category-1",
    categoryName: "Seating",
    badge: null,
    isFeatured: false,
    sortOrder: 0,
    imageUrl: null,
    imageAlt: null,
    effectivePriceAmountMinor: 10000,
    activeDiscount: null,
    name: "Studio Chair",
    meta: "",
    description: "",
    material: "",
    dimensions: "",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeListItem(overrides: Partial<AdminProductListItem> = {}): AdminProductListItem {
  return {
    id: "product-1",
    slug: "studio-chair",
    status: "ACTIVE",
    priceAmountMinor: 10000,
    currency: "EUR",
    categoryName: "Seating",
    name: "Studio Chair",
    updatedAt: new Date(),
    effectivePriceAmountMinor: 10000,
    activeDiscount: null,
    ...overrides,
  };
}

function makeFakeProductRepository(options: {
  product?: AdminProduct;
  listPage?: AdminProductListPage;
}): ProductRepository {
  const product = options.product ?? makeAdminProduct();
  const listPage = options.listPage ?? { items: [makeListItem()], total: 1, page: 1, pageSize: 20 };

  return {
    async findActiveById() {
      throw new Error("not used by these tests");
    },
    async findActiveByIds() {
      throw new Error("not used by these tests");
    },
    async listActive() {
      throw new Error("not used by these tests");
    },
    async listCategories() {
      throw new Error("not used by these tests");
    },
    async listForAdmin() {
      return listPage;
    },
    async findByIdForAdmin(id: string) {
      return id === product.id ? product : null;
    },
    async createProduct() {
      throw new Error("not used by these tests");
    },
    async updateProduct() {
      throw new Error("not used by these tests");
    },
    async categoryExists() {
      throw new Error("not used by these tests");
    },
    async slugExists() {
      throw new Error("not used by these tests");
    },
    async categorySlugExists() {
      throw new Error("not used by these tests");
    },
    async createCategory() {
      throw new Error("not used by these tests");
    },
    async compareAndSetProductImage() {
      throw new Error("not used by these tests");
    },
    async listDiscountsForProduct() {
      throw new Error("not used by these tests");
    },
    async listAdminDiscounts() {
      throw new Error("not used by these tests");
    },
    async findAdminDiscountById() {
      throw new Error("not used by these tests");
    },
    async createProductDiscount() {
      throw new Error("not used by these tests");
    },
    async updateProductDiscount() {
      throw new Error("not used by these tests");
    },
    async setProductDiscountActive() {
      throw new Error("not used by these tests");
    },
    async deleteProductDiscount() {
      throw new Error("not used by these tests");
    },
  };
}

function makeFakeInventoryRepository(
  availabilityByProductId: Record<string, ProductAvailability | null>,
  historyPage?: StockAdjustmentListPage,
): InventoryRepository {
  return {
    async reserveStock() {
      throw new Error("not used by these tests");
    },
    async consumeReservation() {
      throw new Error("not used by these tests");
    },
    async releaseReservation() {
      throw new Error("not used by these tests");
    },
    async securePaymentWindow() {
      throw new Error("not used by these tests");
    },
    async adjustStock() {
      throw new Error("not used by these tests");
    },
    async setTrackInventory() {
      throw new Error("not used by these tests");
    },
    async recordInventoryException() {
      throw new Error("not used by these tests");
    },
    async getProductAvailability(productId: string) {
      return availabilityByProductId[productId] ?? null;
    },
    async getProductsAvailability(productIds: string[]) {
      const result = new Map<string, ProductAvailability>();
      for (const productId of productIds) {
        const availability = availabilityByProductId[productId];
        if (availability) {
          result.set(productId, availability);
        }
      }
      return result;
    },
    async listLowStockProducts() {
      throw new Error("not used by these tests");
    },
    async listStockAdjustments() {
      if (!historyPage) {
        throw new Error("not used by these tests");
      }
      return historyPage;
    },
  };
}

describe("listAdminInventory", () => {
  it("joins each listed product with its availability, flagging low stock from the already-computed available value", async () => {
    const productRepository = makeFakeProductRepository({
      listPage: { items: [makeListItem({ id: "product-1" })], total: 1, page: 1, pageSize: 20 },
    });
    const inventoryRepository = makeFakeInventoryRepository({
      "product-1": {
        productId: "product-1",
        trackInventory: true,
        stockQuantity: 10,
        reserved: 6,
        available: 4,
      },
    });

    const page = await listAdminInventory(productRepository, inventoryRepository, {
      page: 1,
      pageSize: 20,
    });

    expect(page.items).toEqual([
      {
        productId: "product-1",
        name: "Studio Chair",
        slug: "studio-chair",
        trackInventory: true,
        stockQuantity: 10,
        reserved: 6,
        available: 4,
        lowStock: true,
      },
    ]);
  });

  it("reports an untracked product's available as null and lowStock as false, never a numeric fallback", async () => {
    const productRepository = makeFakeProductRepository({
      listPage: { items: [makeListItem({ id: "product-1" })], total: 1, page: 1, pageSize: 20 },
    });
    const inventoryRepository = makeFakeInventoryRepository({
      "product-1": {
        productId: "product-1",
        trackInventory: false,
        stockQuantity: 0,
        reserved: 0,
        available: null,
      },
    });

    const page = await listAdminInventory(productRepository, inventoryRepository, {
      page: 1,
      pageSize: 20,
    });

    expect(page.items[0]).toMatchObject({
      trackInventory: false,
      available: null,
      lowStock: false,
    });
  });

  it("Chat 3 Finding 3 (MEDIUM): fetches availability for the whole page in one batched call, never one call per product", async () => {
    const productRepository = makeFakeProductRepository({
      listPage: {
        items: [makeListItem({ id: "product-1" }), makeListItem({ id: "product-2" })],
        total: 2,
        page: 1,
        pageSize: 20,
      },
    });
    let getProductAvailabilityCalls = 0;
    const getProductsAvailabilityCalls: string[][] = [];
    const inventoryRepository: InventoryRepository = {
      ...makeFakeInventoryRepository({}),
      async getProductAvailability() {
        getProductAvailabilityCalls += 1;
        return null;
      },
      async getProductsAvailability(productIds: string[]) {
        getProductsAvailabilityCalls.push(productIds);
        return new Map([
          [
            "product-1",
            {
              productId: "product-1",
              trackInventory: true,
              stockQuantity: 10,
              reserved: 2,
              available: 8,
            },
          ],
          [
            "product-2",
            {
              productId: "product-2",
              trackInventory: false,
              stockQuantity: 0,
              reserved: 0,
              available: null,
            },
          ],
        ]);
      },
    };

    const page = await listAdminInventory(productRepository, inventoryRepository, {
      page: 1,
      pageSize: 20,
    });

    expect(getProductAvailabilityCalls).toBe(0);
    expect(getProductsAvailabilityCalls).toEqual([["product-1", "product-2"]]);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ productId: "product-1", available: 8 });
    expect(page.items[1]).toMatchObject({ productId: "product-2", available: null });
  });

  it("passes search through to the product repository's filter", async () => {
    let capturedOptions: AdminProductListOptions | undefined;
    const productRepository: ProductRepository = {
      ...makeFakeProductRepository({}),
      async listForAdmin(options: AdminProductListOptions) {
        capturedOptions = options;
        return { items: [], total: 0, page: 1, pageSize: 20 };
      },
    };
    const inventoryRepository = makeFakeInventoryRepository({});

    await listAdminInventory(productRepository, inventoryRepository, {
      search: "chair",
      page: 1,
      pageSize: 20,
    });

    expect(capturedOptions?.filter).toEqual({ search: "chair" });
  });
});

describe("getAdminInventoryProduct", () => {
  it("returns null when the product does not exist, never calling getProductAvailability", async () => {
    const productRepository = makeFakeProductRepository({});
    let availabilityCalled = false;
    const inventoryRepository: InventoryRepository = {
      ...makeFakeInventoryRepository({}),
      async getProductAvailability() {
        availabilityCalled = true;
        return null;
      },
    };

    const result = await getAdminInventoryProduct(
      productRepository,
      inventoryRepository,
      "does-not-exist",
    );
    expect(result).toBeNull();
    expect(availabilityCalled).toBe(false);
  });

  it("combines the product's name/slug with its availability", async () => {
    const productRepository = makeFakeProductRepository({});
    const inventoryRepository = makeFakeInventoryRepository({
      "product-1": {
        productId: "product-1",
        trackInventory: true,
        stockQuantity: 10,
        reserved: 2,
        available: 8,
      },
    });

    const result = await getAdminInventoryProduct(
      productRepository,
      inventoryRepository,
      "product-1",
    );
    expect(result).toEqual({
      productId: "product-1",
      name: "Studio Chair",
      slug: "studio-chair",
      trackInventory: true,
      stockQuantity: 10,
      reserved: 2,
      available: 8,
    });
  });
});

describe("listAdminStockHistory", () => {
  it("delegates directly to InventoryRepository.listStockAdjustments", async () => {
    const historyPage: StockAdjustmentListPage = {
      items: [
        {
          id: "adjustment-1",
          productId: "product-1",
          productName: "Studio Chair",
          quantityChange: 5,
          reason: "Restock",
          adminUserId: "admin-1",
          createdAt: new Date(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    const inventoryRepository = makeFakeInventoryRepository({}, historyPage);

    const result = await listAdminStockHistory(inventoryRepository, {
      filter: { productId: "product-1" },
      page: 1,
      pageSize: 20,
    });
    expect(result).toBe(historyPage);
  });
});
