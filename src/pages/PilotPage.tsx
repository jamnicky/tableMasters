import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Order as DbOrder } from '@/types/database';

interface OrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  menu_items: {
    name: string;
    category?: string;
  };
}

interface Order {
  id: string;
  table_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  order_items: OrderItem[];
}

export function PilotPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [tenant, setTenant] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantAndOrders();

    // Real-time synchronization with Supabase orders & order items
    const sb = supabase;
    if (!sb) return;
    const channel = sb
      .channel('captain-floor-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          fetchTenantAndOrders();
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [tenantSlug]);

  async function fetchTenantAndOrders() {
    const sb = supabase;
    if (!sb) return;
    try {
      const { data: tenantData } = await sb
        .from('tenants')
        .select('*')
        .eq('slug', tenantSlug || 'acme-bistro')
        .single();

      if (tenantData) {
        setTenant(tenantData);

        // Fetch orders with explicit menu_items query join
        const { data: ordersData, error } = await sb
          .from('orders')
          .select(`
            *,
            order_items (
              id,
              quantity,
              unit_price,
              menu_items ( name, category )
            )
          `)
          .eq('tenant_id', tenantData.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (ordersData) setOrders(ordersData as unknown as Order[]);
    }
  } catch (err) {
    console.error('Error fetching pilot data:', err);
  } finally {
    setLoading(false);
  }
}


  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string, successMsg: string) => {
    const sb = supabase;
    if (!sb) return;
    try {
      const { error } = await sb
        .from('orders')
        .update(
          {
            status: newStatus as DbOrder['status'],
            ...(newStatus === 'completed' ? { served_at: new Date().toISOString() } : {}),
          } as unknown as Partial<DbOrder>
        )
        .eq('id', orderId);

      if (error) throw error;
      showToast(successMsg);
      fetchTenantAndOrders();
    } catch (err) {
      console.error(err);
      showToast('Failed to update order status');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f9f9ff] text-[#5a4138] flex items-center justify-center font-sans font-semibold">
        Initializing Captain Station...
      </div>
    );
  }

  const pendingOrders = orders.filter((o) => o.status === 'pending');
  const readyOrders = orders.filter((o) => o.status === 'ready');
  const inPrepOrders = orders.filter((o) => o.status === 'in_preparation');

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#111c2d] font-sans pb-24 antialiased selection:bg-[#ffdbce] selection:text-[#370e00]">
      {/* Top Header Navigation */}
      <header className="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#006c49] animate-pulse"></span>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#006c49]">Floor Active</span>
              </div>
              <h1 className="text-base font-bold tracking-tight text-[#111c2d]">Assigned Tables</h1>
            </div>
            <div className="inline-flex items-center gap-1 bg-[#e7eeff] px-2.5 py-1 rounded-full ml-2">
              <span className="text-[#a33900] font-bold text-xs">7 Tables</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button aria-label="Notifications" className="relative w-10 h-10 rounded-full flex items-center justify-center text-[#111c2d] hover:bg-[#e7eeff] transition-colors">
              <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#a33900] border-2 border-white"></span>
              🔔
            </button>
            <div className="w-8 h-8 rounded-full bg-[#a33900] flex items-center justify-center text-white font-bold text-xs shadow-sm">
              CK
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="max-w-md mx-auto pt-20 px-4 space-y-4">
        {/* Captain Identity & Shift Overview */}
        <div className="bg-white p-4 rounded-xl shadow-sm space-y-3 border border-[#e2bfb2]/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 rounded-full overflow-hidden bg-[#ffdbce] flex items-center justify-center font-bold text-[#370e00]">
                CK
                <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#006c49] ring-2 ring-white"></div>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-[#111c2d]">Capt. Karthik R.</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[#6cf8bb] text-[#00714d] text-[10px] font-bold uppercase">Active</span>
                </div>
                <p className="text-xs text-[#5a4138]">Zone B • {tenant?.name || 'Pascah Avadi Main Hall'}</p>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-mono text-sm font-bold text-[#825100]">
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-[10px] text-[#006c49] font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#006c49] animate-pulse"></span>
                KDS Live Sync
              </span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            <div className="bg-[#f0f3ff] rounded-lg p-2 text-center">
              <span className="text-[10px] text-[#5a4138] uppercase font-bold">Tables</span>
              <p className="text-lg font-bold text-[#111c2d]">4</p>
              <span className="text-[10px] text-[#5a4138]/70">Assigned</span>
            </div>
            <div className="bg-[#f0f3ff] rounded-lg p-2 text-center">
              <span className="text-[10px] text-[#5a4138] uppercase font-bold">Tickets</span>
              <p className="text-lg font-bold text-[#111c2d]">{orders.length}</p>
              <span className="text-[10px] text-[#5a4138]/70">Active</span>
            </div>
            <div className="bg-[#6cf8bb]/40 rounded-lg p-2 text-center border border-[#6cf8bb]">
              <span className="text-[10px] text-[#00714d] uppercase font-bold">Pass</span>
              <p className="text-lg font-bold text-[#00714d]">{readyOrders.length}</p>
              <span className="text-[10px] text-[#00714d]">Ready</span>
            </div>
            <div className="bg-[#ffddb8] rounded-lg p-2 text-center">
              <span className="text-[10px] text-[#653e00] uppercase font-bold">Self-QR</span>
              <p className="text-lg font-bold text-[#2a1700]">{pendingOrders.length}</p>
              <span className="text-[10px] text-[#653e00]">Pending</span>
            </div>
          </div>
        </div>

        {/* Section 1: New QR Orders to Review */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#cc4900]"></span>
              <h3 className="text-xs uppercase font-bold tracking-wider text-[#111c2d]">New Orders to Review</h3>
            </div>
            <span className="text-[10px] bg-[#ffdbce] text-[#370e00] px-2 py-0.5 rounded-full font-bold">
              {pendingOrders.length} Action Required
            </span>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="p-6 bg-white rounded-xl text-center text-sm text-[#5a4138] border border-[#e2bfb2]/20">
              No pending customer orders awaiting review.
            </div>
          ) : (
            pendingOrders.map((order) => (
              <div key={order.id} className="bg-white rounded-xl shadow-sm overflow-hidden border-t-4 border-[#a33900] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#a33900]">{order.table_number}</span>
                      <span className="text-xs text-[#5a4138]">ID: {order.id.slice(0, 6)}...</span>
                    </div>
                    <p className="text-xs text-[#5a4138] mt-0.5">Self-Order QR • Placed {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <span className="text-[10px] bg-[#ffddb8] text-[#2a1700] px-2.5 py-1 rounded-full font-bold uppercase">
                    Reviewing
                  </span>
                </div>

                <div className="bg-[#f0f3ff] rounded-lg p-3 space-y-2">
                  {order.order_items?.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#a33900]">{item.quantity}x</span>
                        <span className="font-semibold text-[#111c2d]">{item.menu_items?.name}</span>
                      </div>
                      <span className="font-mono text-xs text-[#5a4138]">₹{(item.unit_price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'in_preparation', `Order for ${order.table_number} accepted & fired to kitchen!`)}
                    className="flex-1 py-3 bg-[#a33900] hover:bg-[#cc4900] text-white rounded-lg font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition"
                  >
                    🔥 Accept & Fire to Kitchen
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        {/* Section 2: Hot Pass - Ready for Pickup */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#006c49] animate-pulse"></span>
              <h3 className="text-xs uppercase font-bold tracking-wider text-[#111c2d]">Hot Pass • Ready for Pickup</h3>
            </div>
            <span className="text-[10px] bg-[#6cf8bb] text-[#00714d] px-2 py-0.5 rounded-full font-bold">
              {readyOrders.length} Ready
            </span>
          </div>

          {readyOrders.length === 0 ? (
            <div className="p-6 bg-white rounded-xl text-center text-sm text-[#5a4138] border border-[#e2bfb2]/20">
              No dishes waiting at the Hot Pass right now.
            </div>
          ) : (
            readyOrders.map((order) => (
              <div key={order.id} className="bg-white rounded-xl shadow-md overflow-hidden border-t-4 border-[#006c49] p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#006c49] text-base">{order.table_number}</span>
                      <span className="text-xs text-[#5a4138]">Total: ₹{order.total_amount.toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-[#5a4138]">Ready for immediate table service</p>
                  </div>
                  <span className="text-[10px] bg-[#6cf8bb]/50 text-[#00714d] px-2.5 py-1 rounded-full font-bold uppercase animate-pulse">
                    Hot Pass
                  </span>
                </div>

                <div className="space-y-2">
                  {order.order_items?.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2.5 bg-[#f0f3ff] rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-[#006c49] text-white flex items-center justify-center text-xs font-bold">✓</span>
                        <span className="text-sm font-semibold text-[#111c2d]">{item.quantity}x {item.menu_items?.name}</span>
                      </div>
                      <span className="text-xs font-mono text-[#006c49] font-bold uppercase">Ready</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => handleUpdateStatus(order.id, 'completed', `Table ${order.table_number} marked as served successfully!`)}
                  className="w-full py-3 bg-[#006c49] hover:bg-[#005236] text-white rounded-lg font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition"
                >
                  ✓ Mark All as Served to Table
                </button>
              </div>
            ))
          )}
        </section>

        {/* Section 3: Kitchen In Preparation */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#825100]"></span>
              <h3 className="text-xs uppercase font-bold tracking-wider text-[#111c2d]">Kitchen Firing Status</h3>
            </div>
            <span className="text-[10px] text-[#5a4138]">Realtime KDU</span>
          </div>

          {inPrepOrders.length === 0 ? (
            <div className="p-6 bg-white rounded-xl text-center text-sm text-[#5a4138] border border-[#e2bfb2]/20">
              No orders currently cooking in the kitchen.
            </div>
          ) : (
            inPrepOrders.map((order) => (
              <div key={order.id} className="bg-white rounded-xl shadow-sm p-4 space-y-3 opacity-90 border border-[#e2bfb2]/25">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono font-bold text-[#111c2d] text-base">{order.table_number}</span>
                    <p className="text-xs text-[#5a4138]">Cooking in progress • {order.order_items?.length} items</p>
                  </div>
                  <span className="text-[10px] bg-[#ffddb8] text-[#653e00] px-2.5 py-1 rounded-full font-bold uppercase">
                    In Wok / KDS
                  </span>
                </div>

                <div className="p-2.5 bg-[#f0f3ff] rounded-lg space-y-1">
                  {order.order_items?.map((item) => (
                    <div key={item.id} className="flex justify-between text-xs text-[#111c2d] font-medium">
                      <span>{item.quantity}x {item.menu_items?.name}</span>
                      <span className="text-[#825100]">Preparing</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-20 left-4 right-4 z-50 bg-[#263143] text-[#ecf1ff] p-3 rounded-xl shadow-lg flex items-center justify-between">
          <span className="text-sm font-medium">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-xs text-[#ecf1ff]/70">✕</button>
        </div>
      )}

      {/* Bottom Navigation Dock */}
      <nav className="fixed bottom-0 w-full z-50 bg-white/90 backdrop-blur-xl border-t border-[#e2bfb2]/30">
        <div className="h-16 px-2 flex items-center justify-around text-[#5a4138]">
          <button className="flex flex-col items-center justify-center text-[#a33900] font-bold text-xs">
            <span>🍽️</span>
            <span>Tables</span>
          </button>
          <button onClick={() => window.location.href = `/${tenantSlug}/kitchen`} className="flex flex-col items-center justify-center hover:text-[#111c2d] text-xs">
            <span>🍳</span>
            <span>Kitchen</span>
          </button>
          <button onClick={() => window.location.href = `/${tenantSlug}/admin`} className="flex flex-col items-center justify-center hover:text-[#111c2d] text-xs">
            <span>📊</span>
            <span>Admin</span>
          </button>
          <button onClick={() => window.location.href = `/${tenantSlug}/menu`} className="flex flex-col items-center justify-center hover:text-[#111c2d] text-xs">
            <span>📱</span>
            <span>Menu QR</span>
          </button>
        </div>
      </nav>
    </div>
  );
}