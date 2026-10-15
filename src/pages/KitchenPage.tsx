import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Clock, CheckCircle2, Flame, BellRing, UtensilsCrossed, AlertCircle } from 'lucide-react';

interface OrderItem {
  id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  customizations?: any;
}

interface Order {
  id: string;
  table_number: string;
  status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
  order_type: string;
  total_amount: number;
  created_at: string;
  order_items?: OrderItem[];
}

export function KitchenPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [tenant, setTenant] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOrderAlert, setNewOrderAlert] = useState(false);

  useEffect(() => {
    fetchTenantAndOrders();
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenant?.id) return;

    // Subscribe to real-time order updates for this specific tenant
    const channel = supabase
      .channel(`kitchen-orders-${tenant.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => {
          // Trigger alert on updates and refresh list
          setNewOrderAlert(true);
          setTimeout(() => setNewOrderAlert(false), 3000);
          fetchOrdersOnly(tenant.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

  async function fetchTenantAndOrders() {
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', tenantSlug || 'acme-bistro')
      .single();

    if (tenantData) {
      setTenant(tenantData);
      await fetchOrdersOnly(tenantData.id);
    }
    setLoading(false);
  }

  async function fetchOrdersOnly(tenantId: string) {
    const { data: activeOrders } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (*)
      `)
      .eq('tenant_id', tenantId)
      .neq('status', 'delivered')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true });

    if (activeOrders) {
      setOrders(activeOrders as Order[]);
    }
  }

  const updateOrderStatus = async (orderId: string, newStatus: Order['status']) => {
    // Optimistic UI update
    setOrders((prev) =>
      prev
        .map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
        .filter((o) => o.status !== 'delivered' && o.status !== 'cancelled')
    );

    await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);
  };

  const getStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'pending':
        return <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Pending</span>;
      case 'preparing':
        return <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1"><Flame className="w-3.5 h-3.5" /> Preparing</span>;
      case 'ready':
        return <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Ready</span>;
      default:
        return null;
    }
  };

  const getTimeElapsed = (timestamp: string) => {
    const minutes = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 60000);
    return minutes < 1 ? 'Just now' : `${minutes}m ago`;
  };

  const filterByStatus = (status: Order['status']) => orders.filter((o) => o.status === status);

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans">Loading KDU...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4">
      {/* KDU Header */}
      <header className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 flex items-center justify-between shadow-xl">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
            <UtensilsCrossed className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-amber-400">{tenant?.name || 'Kitchen Display'}</h1>
            <p className="text-xs text-slate-400">Live KDU Dashboard • Real-time Sync Active</p>
          </div>
        </div>

        {newOrderAlert && (
          <div className="animate-bounce bg-amber-500 text-slate-950 px-4 py-2 rounded-xl font-bold text-sm flex items-center space-x-2 shadow-lg">
            <BellRing className="w-4 h-4" />
            <span>New Order Received!</span>
          </div>
        )}

        <div className="text-right text-xs text-slate-400">
          <span className="font-semibold text-slate-200">{orders.length} Active Orders</span>
        </div>
      </header>

      {/* 3-Column Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Pending Column */}
        <Column
          title="New Orders"
          count={filterByStatus('pending').length}
          accent="border-amber-500/30"
        >
          {filterByStatus('pending').map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              timeElapsed={getTimeElapsed(order.created_at)}
              statusBadge={getStatusBadge(order.status)}
              actionButton={
                <button
                  onClick={() => updateOrderStatus(order.id, 'preparing')}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition text-sm flex items-center justify-center space-x-1"
                >
                  <Flame className="w-4 h-4" />
                  <span>Start Preparing</span>
                </button>
              }
            />
          ))}
        </Column>

        {/* Preparing Column */}
        <Column
          title="In Preparation"
          count={filterByStatus('preparing').length}
          accent="border-blue-500/30"
        >
          {filterByStatus('preparing').map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              timeElapsed={getTimeElapsed(order.created_at)}
              statusBadge={getStatusBadge(order.status)}
              actionButton={
                <button
                  onClick={() => updateOrderStatus(order.id, 'ready')}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition text-sm flex items-center justify-center space-x-1"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Mark as Ready</span>
                </button>
              }
            />
          ))}
        </Column>

        {/* Ready Column */}
        <Column
          title="Ready for Service"
          count={filterByStatus('ready').length}
          accent="border-emerald-500/30"
        >
          {filterByStatus('ready').map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              timeElapsed={getTimeElapsed(order.created_at)}
              statusBadge={getStatusBadge(order.status)}
              actionButton={
                <button
                  onClick={() => updateOrderStatus(order.id, 'delivered')}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition text-sm flex items-center justify-center space-x-1"
                >
                  <span>Complete & Serve</span>
                </button>
              }
            />
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({ title, count, accent, children }: { title: string; count: number; accent: string; children: React.ReactNode }) {
  return (
    <div className={`bg-slate-900/60 border ${accent} rounded-2xl p-4 flex flex-col min-h-[70vh]`}>
      <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-800">
        <h2 className="font-bold text-slate-200">{title}</h2>
        <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full text-xs font-semibold">{count}</span>
      </div>
      <div className="space-y-4 flex-1">{children}</div>
    </div>
  );
}

function OrderCard({ order, timeElapsed, statusBadge, actionButton }: { order: Order; timeElapsed: string; statusBadge: React.ReactNode; actionButton: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md flex flex-col justify-between space-y-4">
      <div>
        <div className="flex justify-between items-start mb-2">
          <div>
            <span className="text-lg font-black text-amber-400">{order.table_number}</span>
            <span className="text-xs text-slate-400 ml-2">({order.order_type})</span>
          </div>
          {statusBadge}
        </div>

        <div className="flex items-center text-xs text-slate-500 mb-3 space-x-1">
          <Clock className="w-3.5 h-3.5" />
          <span>Placed {timeElapsed}</span>
        </div>

        {/* Order Items List */}
        <div className="space-y-1.5 border-t border-slate-800/80 pt-3">
          {order.order_items?.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-slate-300 font-medium">
                <strong className="text-amber-400 font-bold mr-1">{item.quantity}x</strong> {item.item_name}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2">{actionButton}</div>
    </div>
  );
}
