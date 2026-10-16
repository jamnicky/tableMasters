import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Order } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Singleton Supabase client. When Supabase credentials are not configured,
 * we still export a client object shaped like the real one so the rest of
 * the app can import it without crashing. All mutations fall back to the
 * in-memory mock store below.
 */
let supabase: SupabaseClient<Database> | null = null;

if (hasSupabaseConfig) {
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: 'public' },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

export { supabase };
export type { Database };
export { hasSupabaseConfig };

// ---------------------------------------------------------------------------
// In-memory mock store (used when Supabase is not configured)
// ---------------------------------------------------------------------------

interface MockOrderItem {
  id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  customizations: string | null;
}

interface MockOrder {
  id: string;
  tenant_id: string;
  table_number: string | number;
  status: Order['status'];
  total: number;
  customer_name: string | null;
  order_type: string;
  created_at: string;
  updated_at: string;
  order_items?: MockOrderItem[];
}

interface MockWaiterCall {
  id: string;
  tenant_id: string;
  table_number: string | number;
  order_id: string | null;
  message: string | null;
  status: 'pending' | 'acknowledged' | 'resolved';
  created_at: string;
  updated_at: string;
}

interface MockMenuItem {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
  is_available: boolean;
  image_url: string | null;
  customization_options: string | null;
  created_at: string;
  updated_at: string;
}

const MOCK_TENANTS: Record<string, any> = {
  'acme-bistro': {
    id: 't_00000000-0000-0000-0000-000000000001',
    name: 'Acme Bistro',
    slug: 'acme-bistro',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  'sunset-cafe': {
    id: 't_00000000-0000-0000-0000-000000000002',
    name: 'Sunset Cafe',
    slug: 'sunset-cafe',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

const MOCK_MENU_ITEMS: MockMenuItem[] = [
  {
    id: 'm_001',
    tenant_id: 't_00000000-0000-0000-0000-000000000001',
    name: 'Margherita Pizza',
    description: 'Fresh mozzarella, tomato sauce, basil',
    price: 1299,
    category: 'Mains',
    is_available: true,
    image_url: 'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=500&q=80',
    customization_options: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'm_002',
    tenant_id: 't_00000000-0000-0000-0000-000000000001',
    name: 'Caesar Salad',
    description: 'Romaine lettuce, parmesan, croutons, caesar dressing',
    price: 899,
    category: 'Appetizers',
    is_available: true,
    image_url: 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=500&q=80',
    customization_options: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'm_003',
    tenant_id: 't_00000000-0000-0000-0000-000000000001',
    name: 'Classic Cheeseburger',
    description: 'Beef patty, cheddar, lettuce, tomato, brioche bun',
    price: 1099,
    category: 'Mains',
    is_available: true,
    image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80',
    customization_options: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'm_004',
    tenant_id: 't_00000000-0000-0000-0000-000000000001',
    name: 'Fresh Orange Juice',
    description: 'Freshly squeezed orange juice',
    price: 499,
    category: 'Drinks',
    is_available: true,
    image_url: 'https://images.unsplash.com/photo-1624578612452-916191a92b4e?w=500&q=80',
    customization_options: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'm_005',
    tenant_id: 't_00000000-0000-0000-0000-000000000001',
    name: 'Tiramisu',
    description: 'Espresso-soaked ladyfingers, mascarpone, cocoa',
    price: 699,
    category: 'Desserts',
    is_available: true,
    image_url: 'https://images.unsplash.com/photo-1573883663580-d92b07e91273?w=500&q=80',
    customization_options: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

let MOCK_ORDERS: MockOrder[] = [];
let MOCK_WAITER_CALLS: MockWaiterCall[] = [];

function mockId() {
  return 'mock_' + Math.random().toString(36).slice(2, 11);
}

// ---------------------------------------------------------------------------
// CRUD Helpers
// ---------------------------------------------------------------------------

/** Resolve a tenant by its URL slug. Falls back to mock data. */
export async function getTenantBySlug(slug: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', slug)
      .single();
    if (error) throw error;
    return { data, error: null };
  }
  const tenant = MOCK_TENANTS[slug] || null;
  return { data: tenant, error: tenant ? null : new Error('Tenant not found') };
}

/** Fetch menu items for a tenant. Falls back to mock data. */
export async function getMenuItems(tenantId: string, availableOnly = true) {
  if (supabase) {
    let query = supabase.from('menu_items').select('*').eq('tenant_id', tenantId);
    if (availableOnly) query = query.eq('is_available', true);
    const { data, error } = await query.order('category', { ascending: true });
    if (error) throw error;
    return { data, error: null };
  }
  const items = MOCK_MENU_ITEMS.filter(
    (i) => i.tenant_id === tenantId && (!availableOnly || i.is_available),
  );
  return { data: items, error: null };
}

/** Create an order with line items. Falls back to mock data. */
export async function createOrder(orderData: {
  tenant_id: string;
  table_number: string | number;
  total: number;
  customer_name?: string | null;
  order_type?: string;
  items: Array<{
    menu_item_id: string;
    quantity: number;
    unit_price: number;
    notes?: string | null;
    customizations?: string | null;
  }>;
}) {
  if (supabase) {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        tenant_id: orderData.tenant_id,
        table_number: orderData.table_number,
        status: 'pending',
        total: orderData.total,
        customer_name: orderData.customer_name ?? null,
        order_type: orderData.order_type ?? 'dine-in',
      })
      .select()
      .single();
    if (orderErr) throw orderErr;

    const orderItems = orderData.items.map((item) => ({
      order_id: order.id,
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      notes: item.notes ?? null,
      customizations: item.customizations ?? null,
    }));

    const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
    if (itemsErr) throw itemsErr;

    return { data: order, error: null };
  }

  const order: MockOrder = {
    id: mockId(),
    tenant_id: orderData.tenant_id,
    table_number: orderData.table_number,
    status: 'pending',
    total: orderData.total,
    customer_name: orderData.customer_name ?? null,
    order_type: orderData.order_type ?? 'dine-in',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    order_items: orderData.items.map((item) => ({
      id: mockId(),
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      notes: item.notes ?? null,
      customizations: item.customizations ?? null,
    })),
  };
  MOCK_ORDERS.push(order);
  return { data: order, error: null };
}

/** Fetch orders for a tenant, optionally filtered by statuses. */
export async function getOrders(
  tenantId: string,
  statuses?: Order['status'][],
) {
  if (supabase) {
    let query = supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (statuses && statuses.length > 0) {
      query = query.in('status', statuses);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { data, error: null };
  }

  let orders = MOCK_ORDERS.filter((o) => o.tenant_id === tenantId);
  if (statuses && statuses.length > 0) {
    orders = orders.filter((o) => statuses.includes(o.status));
  }
  return { data: orders, error: null };
}

/** Update an order's status. Falls back to mock data. */
export async function updateOrderStatus(
  orderId: string,
  status: Order['status'],
) {
  if (supabase) {
    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  }

  const idx = MOCK_ORDERS.findIndex((o) => o.id === orderId);
  if (idx === -1) {
    return { data: null, error: new Error('Order not found') };
  }
  MOCK_ORDERS[idx] = { ...MOCK_ORDERS[idx], status, updated_at: new Date().toISOString() };
  return { data: MOCK_ORDERS[idx], error: null };
}

/** Create a waiter call alert. Falls back to mock data. */
export async function createWaiterCall(data: {
  tenant_id: string;
  table_number: string | number;
  order_id?: string | null;
  message?: string | null;
}) {
  if (supabase) {
    const { data: call, error } = await supabase
      .from('waiter_calls')
      .insert({
        tenant_id: data.tenant_id,
        table_number: data.table_number,
        order_id: data.order_id ?? null,
        message: data.message ?? null,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    return { data: call, error: null };
  }

  const call: MockWaiterCall = {
    id: mockId(),
    tenant_id: data.tenant_id,
    table_number: data.table_number,
    order_id: data.order_id ?? null,
    message: data.message ?? null,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  MOCK_WAITER_CALLS.push(call);
  return { data: call, error: null };
}

/** Fetch waiter calls for a tenant. Falls back to mock data. */
export async function getWaiterCalls(tenantId: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('waiter_calls')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data, error: null };
  }

  const calls = MOCK_WAITER_CALLS.filter((c) => c.tenant_id === tenantId);
  return { data: calls, error: null };
}

/** Resolve a waiter call. Falls back to mock data. */
export async function resolveWaiterCall(callId: string) {
  if (supabase) {
    const { data, error } = await supabase
      .from('waiter_calls')
      .update({ status: 'resolved', updated_at: new Date().toISOString() })
      .eq('id', callId)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  }

  const idx = MOCK_WAITER_CALLS.findIndex((c) => c.id === callId);
  if (idx === -1) {
    return { data: null, error: new Error('Waiter call not found') };
  }
  MOCK_WAITER_CALLS[idx] = {
    ...MOCK_WAITER_CALLS[idx],
    status: 'resolved',
    updated_at: new Date().toISOString(),
  };
  return { data: MOCK_WAITER_CALLS[idx], error: null };
}

/** Subscribe to real-time order updates for a tenant. Returns a channel to unsubscribe. */
export function subscribeToOrders(
  tenantId: string,
  onChange: () => void,
) {
  if (!supabase) {
    return { unsubscribe: () => {} };
  }
  const channel = supabase
    .channel(`orders-${tenantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `tenant_id=eq.${tenantId}`,
      },
      () => onChange(),
    )
    .subscribe();
  return {
    unsubscribe: () => supabase!.removeChannel(channel),
  };
}

/** Subscribe to real-time waiter call updates for a tenant. */
export function subscribeToWaiterCalls(tenantId: string, onChange: () => void) {
  if (!supabase) {
    return { unsubscribe: () => {} };
  }
  const channel = supabase
    .channel(`waiter-calls-${tenantId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'waiter_calls',
        filter: `tenant_id=eq.${tenantId}`,
      },
      () => onChange(),
    )
    .subscribe();
  return {
    unsubscribe: () => supabase!.removeChannel(channel),
  };
}
