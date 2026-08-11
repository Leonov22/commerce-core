/**
 * Public entry point for the order module. Other modules and the app
 * router must import order functionality through here rather than
 * reaching into `@/modules/order/domain/...`, `.../infrastructure/...`,
 * or `.../repositories/...` directly.
 *
 * IMP-025 is a persistence/domain foundation only — nothing outside this
 * module calls `createOrder` yet (Checkout submission stays disabled, and
 * no Order API exists). This entry point exists so that whichever future
 * milestone adds real Order creation can depend on a stable boundary
 * instead of reaching into Order's internals or importing Prisma directly.
 */
import "server-only";
import { prismaOrderRepository } from "@/modules/order/infrastructure/prisma-order-repository";
import * as orderCommands from "@/modules/order/application/order-commands";
import type { NewOrderInput } from "@/modules/order/repositories/order-repository";

export type { Order, OrderItem, OrderStatus } from "@/modules/order/domain/order";
export type {
  NewOrderInput,
  NewOrderItemInput,
} from "@/modules/order/repositories/order-repository";

export function createOrder(input: NewOrderInput) {
  return orderCommands.createOrder(prismaOrderRepository, input);
}
