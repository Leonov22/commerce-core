/**
 * Cart owns cart state, not product data. A CartItem only references a
 * product by its existing catalog identifier and how many units are in the
 * cart — it never duplicates name, price, category, or image data. Product
 * display information always comes from the catalog presentation layer.
 */
export interface CartItem {
  productId: string;
  quantity: number;
}

export type CartState = CartItem[];
