/**
 * TypeScript interfaces mirroring the Supabase/PostgreSQL schema.
 * These types are consumed by the Supabase client for fully typed
 * queries, inserts, and realtime subscriptions.
 */

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  price: number; // stored in minor currency units (e.g. cents)
  category: string;
  is_available: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  tenant_id: string;
  table_number: string | number;
  status:
    | 'pending'
    | 'confirmed'
    | 'preparing'
    | 'ready'
    | 'served'
    | 'cancelled';
  total: number; // stored in minor currency units (e.g. cents)
  customer_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number; // stored in minor currency units (e.g. cents)
  notes: string | null;
  created_at: string;
}

export interface Waiter {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

/**
 * Supabase Database shape used for client-side typing.
 * Mirror your generated types from `supabase gen types typescript --local`.
 */
export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: Tenant;
        Insert: Omit<Tenant, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Tenant>;
      };
      menu_items: {
        Row: MenuItem;
        Insert: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<MenuItem>;
      };
      orders: {
        Row: Order;
        Insert: Omit<Order, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Order>;
      };
      order_items: {
        Row: OrderItem;
        Insert: Omit<OrderItem, 'id' | 'created_at'>;
        Update: Partial<OrderItem>;
      };
      waiters: {
        Row: Waiter;
        Insert: Omit<Waiter, 'id' | 'created_at'>;
        Update: Partial<Waiter>;
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
