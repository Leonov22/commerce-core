import { NextResponse } from "next/server";
import { validateCustomerInformation, getDeliveryAmountMinor } from "@/modules/checkout";
import type { CustomerInformation, DeliveryMethodKey } from "@/modules/checkout";
import { createOrderFromCheckout, MAX_QUANTITY_PER_ITEM } from "@/modules/order";
import { routing } from "@/core/i18n/routing";
import { isPlainRequestObject } from "@/app/api/orders/validate-request-body";

/**
 * Order Creation boundary for Checkout.
 *
 * POST /api/orders
 *
 * - Accepts only what the client is legitimately responsible for: customer
 *   contact info, cart product ids/quantities, and a delivery method key.
 * - Never accepts or trusts a client-supplied price, line total, subtotal,
 *   delivery amount, total, product name, or currency — every monetary
 *   value is resolved/calculated server-side in
 *   `createOrderFromCheckout` (see `@/modules/order`).
 * - No payment. Every created Order is PENDING.
 */

const MAX_ITEMS_PER_REQUEST = 50;

interface OrderRequestBody {
  customer?: Partial<Record<keyof CustomerInformation, unknown>>;
  items?: unknown;
  deliveryMethod?: unknown;
  locale?: unknown;
}

interface RawOrderItem {
  productId?: unknown;
  quantity?: unknown;
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  if (!isPlainRequestObject(rawBody)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const body = rawBody as OrderRequestBody;

  const customer: CustomerInformation = {
    firstName: typeof body.customer?.firstName === "string" ? body.customer.firstName : "",
    lastName: typeof body.customer?.lastName === "string" ? body.customer.lastName : "",
    email: typeof body.customer?.email === "string" ? body.customer.email : "",
    phone: typeof body.customer?.phone === "string" ? body.customer.phone : "",
  };
  const customerErrors = validateCustomerInformation(customer);
  if (Object.keys(customerErrors).length > 0) {
    return NextResponse.json(
      { error: "INVALID_CUSTOMER_INFORMATION", fields: customerErrors },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "EMPTY_CART" }, { status: 400 });
  }
  if (body.items.length > MAX_ITEMS_PER_REQUEST) {
    return NextResponse.json({ error: "INVALID_CART" }, { status: 400 });
  }

  const items: { productId: string; quantity: number }[] = [];
  for (const rawItem of body.items as RawOrderItem[]) {
    const productId = rawItem?.productId;
    const quantity = rawItem?.quantity;
    if (typeof productId !== "string" || !productId) {
      return NextResponse.json({ error: "INVALID_CART" }, { status: 400 });
    }
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY_PER_ITEM
    ) {
      return NextResponse.json({ error: "INVALID_QUANTITY", productId }, { status: 400 });
    }
    items.push({ productId, quantity });
  }

  if (typeof body.deliveryMethod !== "string") {
    return NextResponse.json({ error: "INVALID_DELIVERY_METHOD" }, { status: 400 });
  }
  const deliveryAmountMinor = getDeliveryAmountMinor(body.deliveryMethod as DeliveryMethodKey);
  if (deliveryAmountMinor === null) {
    return NextResponse.json({ error: "INVALID_DELIVERY_METHOD" }, { status: 400 });
  }

  const locale = routing.locales.includes(body.locale as (typeof routing.locales)[number])
    ? (body.locale as string)
    : routing.defaultLocale;

  try {
    const result = await createOrderFromCheckout({ customer, items, deliveryAmountMinor, locale });

    if (!result.ok) {
      switch (result.error) {
        case "EMPTY_CART":
          return NextResponse.json({ error: "EMPTY_CART" }, { status: 400 });
        case "INVALID_QUANTITY":
          return NextResponse.json(
            { error: "INVALID_QUANTITY", productId: result.productId },
            { status: 400 },
          );
        case "UNRESOLVED_PRODUCTS":
          return NextResponse.json(
            { error: "UNRESOLVED_PRODUCTS", productIds: result.productIds },
            { status: 400 },
          );
        case "INCONSISTENT_CURRENCY":
          return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
        case "AMOUNT_OUT_OF_RANGE":
          return NextResponse.json({ error: "AMOUNT_OUT_OF_RANGE" }, { status: 400 });
        default:
          return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
      }
    }

    const { order } = result;
    return NextResponse.json(
      {
        order: {
          id: order.id,
          status: order.status,
          subtotalAmountMinor: order.subtotalAmountMinor,
          deliveryAmountMinor: order.deliveryAmountMinor,
          totalAmountMinor: order.totalAmountMinor,
          currency: order.currency,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    // Never leak raw database/Prisma errors to the client.
    console.error("[api/orders] failed to create order", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
