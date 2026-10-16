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
  customization_options: string | null; // JSON string of customization groups
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
  tip_amount: number; // stored in minor currency units (e.g. cents)
  payment_method: 'upi' | 'cash' | 'gateway' | null;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  utr_reference: string | null; // UPI transaction reference for direct UPI payments
  customer_name: string | null;
  order_type: string;
  table_number_display?: string;
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
  customizations: string | null; // JSON string of selected customizations
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

export interface WaiterCall {
  id: string;
  tenant_id: string;
  table_number: string | number;
  order_id: string | null;
  message: string | null;
  status: 'pending' | 'acknowledged' | 'resolved';
  created_at: string;
  updated_at: string;
}

export interface TenantSettings {
  id: string;
  tenant_id: string;
  upi_enabled: boolean;
  upi_id: string | null;
  merchant_name: string | null;
  upi_qr_image_url: string | null;
  upi_instruction_notes: string | null;
  gateway_enabled: boolean;
  gateway_provider: 'razorpay' | 'stripe' | null;
  cash_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Supabase Database shape used for client-side typing.
 * Mirror your generated types from `supabase gen types typescript --local`.
 */
export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: Tenant & Record<string, unknown>;
        Insert: Omit<Tenant, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Tenant>;
        Relationships: [];
      };
      menu_items: {
        Row: MenuItem & Record<string, unknown>;
        Insert: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<MenuItem>;
        Relationships: [];
      };
      orders: {
        Row: Order & Record<string, unknown>;
        Insert: Omit<Order, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Order>;
        Relationships: [];
      };
      order_items: {
        Row: OrderItem & Record<string, unknown>;
        Insert: Omit<OrderItem, 'id' | 'created_at'>;
        Update: Partial<OrderItem>;
        Relationships: [];
      };
      waiters: {
        Row: Waiter & Record<string, unknown>;
        Insert: Omit<Waiter, 'id' | 'created_at'>;
        Update: Partial<Waiter>;
        Relationships: [];
      };
      waiter_calls: {
        Row: WaiterCall & Record<string, unknown>;
        Insert: Omit<WaiterCall, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<WaiterCall>;
        Relationships: [];
      };
      tenant_settings: {
        Row: TenantSettings;
        Insert: Omit<TenantSettings, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<TenantSettings>;
        Relationships: [];
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
