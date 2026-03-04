export interface Product {
  id: string;
  name: string;
  description: string;  // Vietnamese name
  price: number;        // Case price (full case total)
  unitPrice?: number;   // Price per lb / per bag
  packaging?: string;   // e.g. "30 X 14 OZ"
  origin?: string;      // e.g. "VIETNAM"
  method?: string;      // "WILD" | "FARMED"
  weight?: number;      // Total case weight in lbs
  pack?: string;        // e.g. "VP", "IWP", "Box"
  packType?: string;    // "Retail" | "Bulk"
  image?: string;
  oos?: boolean;
  category: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}
