import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { LayoutDashboard, DollarSign, ShoppingBag, Users, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';

interface Order {
  id: string;
  table_number: string;
  status: string;
  order_type: string;
  total_amount: number;
  created_at: string;
}

export function AdminPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [tenant, setTenant] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTenantAndData();
  }, [tenantSlug]);

  async function fetchTenantAndData() {
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', tenantSlug || 'acme-bistro')
      .single();

    if (tenantData) {
      setTenant(tenantData);
      const { data: allOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantData.id)
        .order('created_at', { ascending: false });

      if (allOrders) setOrders(allOrders);
    }
    setLoading(false);
  }

  const totalRevenue = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

  const activeOrdersCount = orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled').length;

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans">Loading Admin Panel...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
      {/* Header */}
      <header className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-6 flex items-center justify-between shadow-xl">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
            <LayoutDashboard className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-amber-400">{tenant?.name || 'Lobby Admin'}</h1>
            <p className="text-xs text-slate-400">Venue Management & Real-time Analytics</p>
          </div>
        </div>
        <button
          onClick={fetchTenantAndData}
          className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition flex items-center space-x-2 text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh Data</span>
        </button>
      </header>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <MetricCard
          title="Total Revenue"
          value={`$${totalRevenue.toFixed(2)}`}
          icon={<DollarSign className="w-5 h-5 text-emerald-400" />}
          accent="border-emerald-500/20 bg-emerald-500/5"
        />
        <MetricCard
          title="Active Orders"
          value={activeOrdersCount}
          icon={<ShoppingBag className="w-5 h-5 text-amber-400" />}
          accent="border-amber-500/20 bg-amber-500/5"
        />
        <MetricCard
          title="Total Orders Logged"
          value={orders.length}
          icon={<Users className="w-5 h-5 text-blue-400" />}
          accent="border-blue-500/20 bg-blue-500/5"
        />
      </div>

      {/* Recent Orders Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-100 mb-4">Live Order History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Order ID</th>
                <th className="py-3 px-4">Table</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-4 font-mono text-xs text-slate-400">{order.id.slice(0, 8)}...</td>
                  <td className="py-3 px-4 font-bold text-amber-400">{order.table_number}</td>
                  <td className="py-3 px-4 text-slate-300 capitalize">{order.order_type}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${
                        order.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : order.status === 'preparing'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : order.status === 'ready'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-200">${Number(order.total_amount).toFixed(2)}</td>
                  <td className="py-3 px-4 text-xs text-slate-500">{new Date(order.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon, accent }: { title: string; value: string | number; icon: React.ReactNode; accent: string }) {
  return (
    <div className={`border ${accent} rounded-2xl p-5 shadow-lg flex items-center justify-between`}>
      <div>
        <p className="text-xs font-medium text-slate-400 mb-1">{title}</p>
        <p className="text-2xl font-black text-slate-100">{value}</p>
      </div>
      <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">{icon}</div>
    </div>
  );
}
