import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PostgrestError } from '@supabase/supabase-js';
import {
  getTenantBySlug,
  getMenuItems,
  getOrders,
  getTenantSettings,
  getWaiterCalls,
  resolveWaiterCall,
  upsertTenantSettings,
  hasSupabaseConfig,
  supabase,
} from '@/lib/supabase';
import type { Database, MenuItem, Order, Tenant, WaiterCall } from '@/types/database';
import {
  ChevronRight,
  Copy,
  DollarSign,
  Edit,
  Link,
  LayoutDashboard,
  Menu,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ShoppingBag,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Utensils,
  Users,
  X,
} from 'lucide-react';

type TabKey = 'menu' | 'orders' | 'qr' | 'payment';
type TableStatus = 'available' | 'pending' | 'occupied' | 'ready' | 'served';
type MenuCategory = 'Appetizers' | 'Mains' | 'Drinks' | 'Desserts';

const TABLE_COUNT = 12;
const MENU_CATEGORIES: MenuCategory[] = ['Appetizers', 'Mains', 'Drinks', 'Desserts'];
const ORDER_STATUSES: Order['status'][] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'served',
  'cancelled',
];

type MenuItemInsert = Database['public']['Tables']['menu_items']['Insert'];
type MenuItemUpdate = Database['public']['Tables']['menu_items']['Update'];

interface MenuItemFormValues {
  name: string;
  description: string;
  price: string; // dollars, entered by admin
  category: MenuCategory;
  image_url: string;
  is_available: boolean;
}

// Structured supabase mutations for menu_items. The installed postgrest-js
// types infer `insert`/`update` payloads as `never` on this builder shape, so
// we bridge the boundary with an explicit structural type while keeping every
// payload fully typed via MenuItemInsert / MenuItemUpdate.
interface MenuItemsMutations {
  insert: (row: MenuItemInsert) => Promise<{ error: PostgrestError | null }>;
  update: (row: MenuItemUpdate) => Promise<{ error: PostgrestError | null }>;
  delete: () => {
    eq: (
      column: string,
      value: string | number,
    ) => Promise<{ error: PostgrestError | null }>;
  };
}

const blankMenuItemForm = (): MenuItemFormValues => ({
  name: '',
  description: '',
  price: '',
  category: 'Mains',
  image_url: '',
  is_available: true,
});

const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const orderStatusToTableStatus = (status: Order['status']): TableStatus => {
  switch (status) {
    case 'pending':
    case 'confirmed':
      return 'occupied';
    case 'preparing':
      return 'pending';
    case 'ready':
      return 'ready';
    case 'served':
      return 'served';
    case 'cancelled':
      return 'available';
  }
};

const tableStatusVariant = (status: TableStatus) => {
  const variants: Record<TableStatus, string> = {
    available: 'bg-slate-800 text-slate-400 border border-slate-700',
    pending: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    occupied: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
    ready: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    served: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  };
  return `px-2.5 py-1 rounded-full text-xs font-semibold border ${variants[status]}`;
};

const orderStatusVariant = (status: Order['status']) => {
  const variants: Record<Order['status'], string> = {
    pending: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    confirmed: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    preparing: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    ready: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    served: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    cancelled: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  };
  return `px-2.5 py-1 rounded-full text-xs font-semibold border ${variants[status]}`;
};

function MetricCard({
  title,
  value,
  icon: Icon,
  accent,
}: {
  title: string;
  value: React.ReactNode;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className={`border rounded-2xl p-5 shadow-lg flex items-center justify-between ${accent}`}>
      <div>
        <p className="text-xs font-medium text-slate-400 mb-1">{title}</p>
        <p className="text-2xl font-black text-slate-100">{value}</p>
      </div>
      <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
        <Icon className="w-5 h-5 text-amber-400" />
      </div>
    </div>
  );
}

export function AdminPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const slug = tenantSlug ?? '';

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tab, setTab] = useState<TabKey>('menu');
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [openItemModal, setOpenItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<MenuItemFormValues>(blankMenuItemForm());
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  /* Payment settings state */
  const [settingsForm, setSettingsForm] = useState<{
    upi_enabled: boolean;
    upi_id: string;
    merchant_name: string;
    upi_qr_image_url: string;
    upi_instruction_notes: string;
    gateway_enabled: boolean;
    gateway_provider: 'razorpay' | 'stripe' | null;
    cash_enabled: boolean;
  }>({
    upi_enabled: false,
    upi_id: '',
    merchant_name: '',
    upi_qr_image_url: '',
    upi_instruction_notes: '',
    gateway_enabled: false,
    gateway_provider: null,
    cash_enabled: true,
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [toasts, setToasts] = useState<{
    id: string;
    message: string;
    kind: 'success' | 'error';
  }[]>([]);

  const addToast = useCallback(
    (message: string, kind: 'success' | 'error' = 'success') => {
      const id = Math.random().toString(36).slice(2, 11);
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    [],
  );

  const loadData = useCallback(async () => {
    if (!tenant) return;
    setRefreshing(true);
    try {
      const [menuRes, ordersRes, callsRes] = await Promise.all([
        getMenuItems(tenant.id, false),
        getOrders(tenant.id),
        getWaiterCalls(tenant.id),
      ]);
      setMenuItems(menuRes.data ?? []);
      setOrders(ordersRes.data ?? []);
      setWaiterCalls(callsRes.data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setRefreshing(false);
    }
  }, [tenant]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTenantBySlug(slug).then(async ({ data, error: err }) => {
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setTenant(data ?? null);
      if (data) {
        await loadData();
        // Load payment settings
        try {
          const { data: settings, error: settingsErr } = await getTenantSettings(data.id);
          if (settingsErr) throw settingsErr;
          if (settings) {
            setSettingsForm({
              upi_enabled: settings.upi_enabled,
              upi_id: settings.upi_id ?? '',
              merchant_name: settings.merchant_name ?? '',
              upi_qr_image_url: settings.upi_qr_image_url ?? '',
              upi_instruction_notes: settings.upi_instruction_notes ?? '',
              gateway_enabled: settings.gateway_enabled,
              gateway_provider: settings.gateway_provider,
              cash_enabled: settings.cash_enabled,
            });
          }
        } catch {
          // Settings may not exist yet; defaults are already set.
        }
      } else {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [slug, loadData]);

  const handleRetry = async () => {
    setError(null);
    setLoading(true);
    const { data, error: err } = await getTenantBySlug(slug);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setTenant(data ?? null);
    if (data) {
      await loadData();
    } else {
      setLoading(false);
    }
  };

  const openAddItem = () => {
    setEditingItem(null);
    setForm(blankMenuItemForm());
    setOpenItemModal(true);
  };

  const openEditItem = (item: MenuItem) => {
    setEditingItem(item);
    setForm({
      name: item.name,
      description: item.description ?? '',
      price: (item.price / 100).toFixed(2),
      category: item.category as MenuCategory,
      image_url: item.image_url ?? '',
      is_available: item.is_available,
    });
    setOpenItemModal(true);
  };

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    if ((e.target as HTMLInputElement).type === 'checkbox') {
      setForm((prev) => ({
        ...prev,
        [name]: (e.target as HTMLInputElement).checked,
      }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant) return;

    const priceDollars = Number(form.price);
    if (!form.name.trim() || Number.isNaN(priceDollars) || priceDollars < 0) {
      addToast('Please enter a valid name and price', 'error');
      return;
    }

    const wasEditing = Boolean(editingItem);
    setSaving(true);

    try {
      const payload: MenuItemInsert = {
        tenant_id: tenant.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: Math.round(priceDollars * 100),
        category: form.category,
        image_url: form.image_url.trim() || null,
        is_available: form.is_available,
        customization_options: null,
      };

      if (hasSupabaseConfig && supabase) {
        const items = supabase.from('menu_items') as unknown as MenuItemsMutations;
        if (editingItem) {
          const { error: dbError } = await items.update(payload);
          if (dbError) throw dbError;
        } else {
          const { error: dbError } = await items.insert(payload);
          if (dbError) throw dbError;
        }
      } else {
        if (editingItem) {
          setMenuItems((prev) =>
            prev.map((i) =>
              i.id === editingItem.id ? { ...i, ...payload } : i,
            ),
          );
        } else {
          const mockItem: MenuItem = {
            ...payload,
            id: `mock_${Math.random().toString(36).slice(2, 11)}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setMenuItems((prev) => [mockItem, ...prev]);
        }
        addToast('Saved locally (mock mode — Supabase not configured)');
      }

      setOpenItemModal(false);
      setEditingItem(null);
      setForm(blankMenuItemForm());
      await loadData();
      addToast(wasEditing ? 'Menu item updated' : 'Menu item created');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save menu item', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!tenant) return;
    setSettingsLoading(true);
    try {
      const { error: dbError } = await upsertTenantSettings({
        tenant_id: tenant.id,
        upi_enabled: settingsForm.upi_enabled,
        upi_id: settingsForm.upi_id.trim() || null,
        merchant_name: settingsForm.merchant_name.trim() || null,
        upi_qr_image_url: settingsForm.upi_qr_image_url.trim() || null,
        upi_instruction_notes: settingsForm.upi_instruction_notes.trim() || null,
        gateway_enabled: settingsForm.gateway_enabled,
        gateway_provider: settingsForm.gateway_provider,
        cash_enabled: settingsForm.cash_enabled,
      });
      if (dbError) throw dbError;
      addToast('Payment settings saved');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save payment settings', 'error');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleToggleAvailability = async (item: MenuItem) => {
    if (!tenant) return;
    setSaving(true);
    try {
      const next = !item.is_available;
      const updatePayload: MenuItemUpdate = { is_available: next };
      if (hasSupabaseConfig && supabase) {
        const items = supabase.from('menu_items') as unknown as MenuItemsMutations;
        const { error: dbError } = await items.update(updatePayload);
        if (dbError) throw dbError;
      } else {
        setMenuItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, is_available: next } : i)),
        );
        addToast('Saved locally (mock mode)');
      }
      await loadData();
    } catch (err) {
      addToast('Failed to toggle availability', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deleteTargetId || !tenant) return;
    setSaving(true);
    try {
      if (hasSupabaseConfig && supabase) {
        const items = supabase.from('menu_items') as unknown as MenuItemsMutations;
        const { error: dbError } = await items.delete().eq('id', deleteTargetId);
        if (dbError) throw dbError;
      } else {
        setMenuItems((prev) => prev.filter((i) => i.id !== deleteTargetId));
        addToast('Deleted locally (mock mode)');
      }
      setDeleteTargetId(null);
      await loadData();
      addToast('Menu item deleted');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete menu item', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResolveCall = async (callId: string) => {
    setSaving(true);
    try {
      const { error: dbError } = await resolveWaiterCall(callId);
      if (dbError) throw dbError;
      setWaiterCalls((prev) =>
        prev.map((c) => (c.id === callId ? { ...c, status: 'resolved' } : c)),
      );
      addToast('Waiter call resolved');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to resolve waiter call', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard?.writeText(url);
      addToast('Link copied to clipboard');
    } catch {
      addToast('Failed to copy link', 'error');
    }
  };

  const downloadLinkText = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const revenueCents = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.total, 0);

  const activeOrdersCount = orders.filter(
    (o) => o.status !== 'served' && o.status !== 'cancelled',
  ).length;

  const pendingCallsCount = waiterCalls.filter((c) => c.status === 'pending').length;

  const latestOrderByTable = useMemo(() => {
    const map = new Map<number, Order>();
    orders.forEach((o) => {
      const t = Number(o.table_number);
      if (!Number.isFinite(t)) return;
      const cur = map.get(t);
      if (!cur || new Date(o.created_at) > new Date(cur.created_at)) {
        map.set(t, o);
      }
    });
    return map;
  }, [orders]);

  const tableRows = useMemo(() => {
    const rows: {
      table: number;
      status: TableStatus;
      order: Order | undefined;
    }[] = [];
    for (let n = 1; n <= TABLE_COUNT; n += 1) {
      const order = latestOrderByTable.get(n);
      rows.push({
        table: n,
        status: order ? orderStatusToTableStatus(order.status) : 'available',
        order,
      });
    }
    return rows;
  }, [latestOrderByTable]);

  const tablesServedCount = tableRows.filter((r) => r.status === 'served').length;

  const salesBreakdown = useMemo(() => {
    return ORDER_STATUSES.map((status) => {
      const items = orders.filter((o) => o.status === status);
      return {
        status,
        count: items.length,
        revenue: items.reduce((sum, o) => sum + o.total, 0),
      };
    });
  }, [orders]);

  const tabs = [
    { key: 'menu' as TabKey, label: 'Menu Management', icon: ShoppingBag },
    { key: 'orders' as TabKey, label: 'Live Monitor', icon: LayoutDashboard },
    { key: 'qr' as TabKey, label: 'Tables & QR', icon: QrCode },
    { key: 'payment' as TabKey, label: 'Payment Settings', icon: DollarSign },
  ];

  const isInitialLoading = loading && !tenant;

  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
          <p className="text-sm">Loading admin panel…</p>
        </div>
      </div>
    );
  }

  if (error && !tenant) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
        <div className="max-w-md mx-auto bg-slate-900 border border-rose-500/30 rounded-2xl p-6 shadow-xl">
          <h2 className="font-bold text-rose-400 mb-2">Tenant not found</h2>
          <p className="text-sm text-slate-400 mb-4">{error}</p>
          <button
            onClick={handleRetry}
            className="text-amber-400 hover:text-amber-300 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-6">
      <style>
        {`
          @media print {
            .no-print { display: none !important; }
            .print-only { display: block !important; }
            body { background: #ffffff !important; color: #0f172a !important; }
            .print-card { break-inside: avoid; page-break-inside: avoid; }
            .qr-section { min-height: auto; }
            header, nav, .tabs-nav, .no-print, .metric-card, table { display: none !important; }
            .print-cards-grid { grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
            .print-card {
              background: #ffffff !important;
              border: 2px solid #0f172a !important;
              color: #0f172a !important;
              box-shadow: none !important;
              padding: 0.5rem !important;
              margin: 0 !important;
            }
            .print-card * { color: #0f172a !important; border-color: #0f172a !important; }
            .print-card .text-slate-400, .print-card .text-slate-500, .print-card .text-slate-600 { color: #475569 !important; }
            .print-card .text-amber-400 { color: #d97706 !important; }
            .print-card .bg-slate-900, .print-card .bg-slate-950, .print-card .bg-slate-800 { background: #ffffff !important; }
            .print-card .border-slate-800, .print-card .border-slate-700 { border-color: #0f172a !important; }
            .print-card .text-slate-100, .print-card .text-slate-200 { color: #0f172a !important; }
            .print-card .shadow-xl, .print-card .shadow-lg, .print-card .shadow-md { box-shadow: none !important; }
          }
        `}
      </style>

      {/* Toasts */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3.5 rounded-xl border text-sm font-medium shadow-xl transition-opacity duration-300 ${
              t.kind === 'success'
                ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-100'
                : 'bg-rose-900/90 border-rose-500/50 text-rose-100'
            }`}
          >
            {t.message}
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="ml-auto p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4 no-print">
        <div className="flex flex-col gap-1">
          <nav className="text-xs text-slate-500 flex items-center gap-1">
            <span>Admin</span>
            <ChevronRight className="w-3 h-3 shrink-0" />
            <span>{tenant.name}</span>
          </nav>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl shadow-lg shadow-amber-500/10">
              <LayoutDashboard className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-amber-400">{tenant.name}</h1>
              <p className="text-xs text-slate-400">
                {slug} ·
                {hasSupabaseConfig ? 'Connected to Supabase' : 'Mock mode (no Supabase config)'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/${slug}/menu`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 transition"
          >
            <Menu className="w-4 h-4" />
            <span>Open customer menu</span>
          </a>
          <a
            href={`/${slug}/waiter`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 transition"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Waiter Terminal</span>
          </a>
          <button
            onClick={loadData}
            disabled={refreshing || !tenant}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 transition disabled:opacity-50"
          >
            {refreshing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex border-b border-slate-800 mb-6 no-print" aria-label="Management tabs">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 py-4 px-1 text-sm font-medium border-b-2 transition ${
                active
                  ? 'border-amber-500 text-amber-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <t.icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Panels */}
      <div className="space-y-8">
        {/* ===== MENU MANAGEMENT ===== */}
        {tab === 'menu' && (
          <section className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-amber-400" />
                  Menu items
                </h2>
                <p className="text-sm text-slate-400">
                  Manage the menu for {tenant.name}
                </p>
              </div>
              <div className="flex gap-3">
                {!hasSupabaseConfig && (
                  <span className="px-2.5 py-1 rounded bg-amber-500/10 text-amber-400 text-xs font-medium border border-amber-500/20">
                    Mock mode
                  </span>
                )}
                <button
                  onClick={openAddItem}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-60 transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Item</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/50 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-4">Image</th>
                      <th className="py-3 px-4">Name</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Price</th>
                      <th className="py-3 px-4">Availability</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {menuItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500">
                          No menu items yet. Click "Add Item" to create one.
                        </td>
                      </tr>
                    ) : (
                      menuItems.map((item) => (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-800/40 transition group"
                        >
                          <td className="py-3 px-4">
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt={item.name}
                                className="w-10 h-10 rounded-lg object-cover bg-slate-800"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-600 text-xs">
                                —
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-200">
                            {item.name}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                              {item.category}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-amber-400">
                            {formatMoney(item.price)}
                          </td>
                          <td className="py-3 px-4">
                            <button
                              onClick={() => handleToggleAvailability(item)}
                              disabled={saving}
                              className={`w-10 h-5 rounded-full border p-0.5 transition ${
                                item.is_available
                                  ? 'border-amber-500 bg-amber-500'
                                  : 'border-slate-600 bg-slate-800'
                              }`}
                            >
                              {item.is_available ? (
                                <ToggleRight className="w-3 h-3 ml-1 text-slate-900" />
                              ) : (
                                <ToggleLeft className="w-3 h-3 mr-1 text-slate-300" />
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => openEditItem(item)}
                              disabled={saving}
                              className="p-2 text-slate-400 hover:text-amber-400 disabled:opacity-50"
                              title="Edit item"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTargetId(item.id)}
                              disabled={saving}
                              className="ml-2 p-2 text-slate-400 hover:text-rose-400 disabled:opacity-50"
                              title="Delete item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ===== LIVE TABLE & ORDER MONITOR ===== */}
        {tab === 'orders' && (
          <section className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <MetricCard
                title="Total Revenue"
                value={formatMoney(revenueCents)}
                icon={DollarSign}
                accent="border-emerald-500/20 bg-emerald-500/5"
              />
              <MetricCard
                title="Active Orders"
                value={activeOrdersCount}
                icon={ShoppingBag}
                accent="border-amber-500/20 bg-amber-500/5"
              />
              <MetricCard
                title="Pending Waiter Calls"
                value={pendingCallsCount}
                icon={Users}
                accent="border-blue-500/20 bg-blue-500/5"
              />
              <MetricCard
                title="Tables Served"
                value={tablesServedCount}
                icon={Users}
                accent="border-slate-500/20 bg-slate-500/5"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8">
                <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
                  <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-100">
                      Table status
                    </h2>
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      {TABLE_COUNT} tables
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          <th className="py-3.5 px-4">Table</th>
                          <th className="py-3.5 px-4">Status</th>
                          <th className="py-3.5 px-4">Current order</th>
                          <th className="py-3.5 px-4 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {tableRows.map((row) => (
                          <tr key={row.table} className="hover:bg-slate-800/40 transition">
                            <td className="py-3.5 px-4 font-medium text-slate-200">
                              Table {row.table}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={tableStatusVariant(row.status)}>
                                {row.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              {row.order ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-slate-400">
                                    #{row.order.id.slice(-6)}
                                  </span>
                                  <ChevronRight className="w-3 h-3 text-slate-600" />
                                </div>
                              ) : (
                                <span className="text-slate-500 text-xs">—</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-slate-200 text-right">
                              {row.order ? formatMoney(row.order.total) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <div className="lg:col-span-4">
                <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-6">
                  <h2 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                    Waiter calls
                    <Users className="w-4 h-4 text-amber-400" />
                  </h2>
                  {waiterCalls.length === 0 ? (
                    <p className="text-slate-500 text-center py-6">No waiter calls.</p>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                      {waiterCalls.map((call) => (
                        <div
                          key={call.id}
                          className="p-3 bg-slate-800/50 border border-slate-800/50 rounded-xl"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-medium text-slate-200">
                              Table {call.table_number}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                call.status === 'pending'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {call.status}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 mb-2">
                            {call.message ?? 'No message'}
                          </p>
                          <p className="text-xs text-slate-500 mb-2">
                            {new Date(call.created_at).toLocaleString()}
                          </p>
                          {call.status === 'pending' ? (
                            <button
                              onClick={() => handleResolveCall(call.id)}
                              disabled={saving}
                              className="w-full py-1.5 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 disabled:opacity-60"
                            >
                              Resolve
                            </button>
                          ) : (
                            <span className="text-xs text-emerald-400">Resolved</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>

            {/* Recent orders */}
            <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-100">Recent orders</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-4">Order</th>
                      <th className="py-3 px-4">Table</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Total</th>
                      <th className="py-3 px-4">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {[
                      ...orders,
                    ]
                      .sort(
                        (a, b) =>
                          new Date(b.created_at).getTime() -
                          new Date(a.created_at).getTime(),
                      )
                      .slice(0, 20)
                      .map((o) => (
                        <tr key={o.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 font-mono text-xs text-slate-400">
                            #{o.id.slice(-6)}
                          </td>
                          <td className="py-3 px-4 font-medium text-amber-400">
                            {o.table_number}
                          </td>
                          <td className="py-3 px-4">
                            <span className={orderStatusVariant(o.status)}>
                              {o.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-200">
                            {formatMoney(o.total)}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-500">
                            {new Date(o.created_at).toLocaleTimeString(
                              [],
                              { hour: '2-digit', minute: '2-digit' },
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Sales overview */}
            <section className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-100">
                  Sales overview by status
                </h2>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Orders</th>
                    <th className="py-3 px-4 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {salesBreakdown.map((b) => (
                    <tr key={b.status} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <span className={orderStatusVariant(b.status)}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-200">{b.count}</td>
                      <td className="py-3 px-4 font-mono text-right text-slate-200">
                        {formatMoney(b.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        )}

        {/* ===== TABLE & QR GENERATOR ===== */}
        {tab === 'qr' && (
          <section className="space-y-6 no-print">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-amber-400" />
                  Table QR Cards
                </h2>
                <p className="text-sm text-slate-400">
                  Printable table cards for Tables 1 to {TABLE_COUNT}. Each card
                  encodes the customer menu URL for that table.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-xs text-slate-500">
                  Origin: {window.location.origin}
                </span>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print All Table Cards</span>
                </button>
              </div>
            </div>

            {/* Preview cards (screen view) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {(() => {
                const cards: JSX.Element[] = [];
                for (let n = 1; n <= TABLE_COUNT; n += 1) {
                  const url = `${window.location.origin}/${slug}/menu?table=${n}`;
                  cards.push(
                    <div
                      key={n}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <QrCode className="w-5 h-5 text-amber-400" />
                        <span className="font-bold text-slate-100">Table {n}</span>
                      </div>
                      <div className="flex-1 mb-3">
                        <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5 tracking-wider">
                          Menu link
                        </label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={url}
                            className="flex-1 text-xs font-mono text-slate-300 bg-slate-950 border border-slate-700 rounded-xl p-2.5 focus:outline-none"
                          />
                          <button
                            onClick={() => copyLink(url)}
                            className="p-2.5 text-slate-400 hover:text-slate-100 rounded-xl hover:bg-slate-800 transition"
                            title="Copy link"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => downloadLinkText(`table-${n}-qr.txt`, url)}
                        className="w-full py-2.5 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl hover:bg-amber-500/20 transition flex items-center justify-center gap-2"
                      >
                        <Link className="w-4 h-4" />
                        <span>Download QR link</span>
                      </button>
                    </div>,
                  );
                }
                return cards;
              })()}
            </div>

            {/* Printable cards (hidden on screen, shown on print) */}
            <div className="print-only print-cards-grid">
              {(() => {
                const cards: JSX.Element[] = [];
                for (let n = 1; n <= TABLE_COUNT; n += 1) {
                  const url = `${window.location.origin}/${slug}/menu?table=${n}`;
                  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
                  cards.push(
                    <div
                      key={n}
                      className="print-card bg-white border-2 border-slate-900 rounded-xl p-3 flex flex-col items-center min-h-[220px] max-w-xs"
                    >
                      {/* Restaurant branding */}
                      <div className="w-full flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="p-1 bg-amber-500 rounded">
                            <Utensils className="w-4 h-4 text-white" />
                          </div>
                          <span className="text-sm font-bold text-slate-900 leading-tight">
                            {tenant?.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Table {n}
                        </span>
                      </div>

                      {/* QR Code */}
                      <div className="w-32 h-32 mb-2 flex items-center justify-center bg-white border border-slate-200 rounded-lg">
                        <img
                          src={qrUrl}
                          alt={`QR code for Table ${n}`}
                          className="w-full h-full"
                          decoding="async"
                        />
                      </div>

                      {/* Menu URL */}
                      <div className="w-full mb-2">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase mb-1">
                          Scan to Order
                        </div>
                        <div
                          className="text-[10px] font-mono text-slate-700 break-all text-center bg-slate-50/50 p-1 rounded"
                          title={url}
                        >
                          {url}
                        </div>
                      </div>

                      {/* Instructions */}
                      <div className="w-full text-center">
                        <div className="text-[9px] font-semibold text-slate-600 uppercase mb-0.5">
                          How to Order
                        </div>
                        <div className="text-[8px] text-slate-600 leading-tight space-y-0.5">
                          <span>1. Scan QR</span>
                          <span>2. Browse Menu</span>
                          <span>3. Order & Pay</span>
                        </div>
                      </div>
                    </div>,
                  );
                }
                return cards;
              })()}
            </div>

            <p className="text-xs text-slate-500 max-w-md print-only">
              Print these cards and place them on each table. Customers scan the
              QR code to access their table-specific menu and place orders.
            </p>
          </section>
        )}

        {/* ===== PAYMENT SETTINGS ===== */}
        {tab === 'payment' && (
          <section className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-amber-400" />
                  Payment Settings
                </h2>
                <p className="text-sm text-slate-400">
                  Configure how customers can pay at {tenant?.name}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSaveSettings}
                  disabled={settingsLoading}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-60 transition"
                >
                  {settingsLoading ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-6">
              <div className="space-y-6">
                {/* Direct UPI */}
                <div className="border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-100 flex items-center gap-2">
                      Direct UPI
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setSettingsForm((prev) => ({ ...prev, upi_enabled: !prev.upi_enabled }))
                      }
                      className={`w-10 h-5 rounded-full border p-0.5 transition ${
                        settingsForm.upi_enabled
                          ? 'border-amber-500 bg-amber-500'
                          : 'border-slate-600 bg-slate-800'
                      }`}
                    >
                      {settingsForm.upi_enabled ? (
                        <ToggleRight className="w-3 h-3 ml-1 text-slate-900" />
                      ) : (
                        <ToggleLeft className="w-3 h-3 mr-1 text-slate-300" />
                      )}
                    </button>
                  </div>
                  {!settingsForm.upi_enabled && (
                    <p className="text-xs text-slate-500 mb-4">
                      Enable UPI to allow customers to pay directly via UPI QR.
                    </p>
                  )}
                  {settingsForm.upi_enabled && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                          UPI ID
                        </label>
                        <input
                          name="upi_id"
                          value={settingsForm.upi_id}
                          onChange={(e) =>
                            setSettingsForm((prev) => ({ ...prev, upi_id: e.target.value }))
                          }
                          placeholder="merchant@upi"
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                          Merchant Display Name
                        </label>
                        <input
                          name="merchant_name"
                          value={settingsForm.merchant_name}
                          onChange={(e) =>
                            setSettingsForm((prev) => ({ ...prev, merchant_name: e.target.value }))
                          }
                          placeholder="Acme Bistro"
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                          Custom QR Image URL (optional)
                        </label>
                        <input
                          name="upi_qr_image_url"
                          value={settingsForm.upi_qr_image_url}
                          onChange={(e) =>
                            setSettingsForm((prev) => ({ ...prev, upi_qr_image_url: e.target.value }))
                          }
                          placeholder="https://example.com/upi-qr.png"
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                          Instruction Notes (optional)
                        </label>
                        <textarea
                          name="upi_instruction_notes"
                          value={settingsForm.upi_instruction_notes}
                          onChange={(e) =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              upi_instruction_notes: e.target.value,
                            }))
                          }
                          rows={2}
                          placeholder="e.g. Please share the UTR reference with staff"
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Online Payment Gateway */}
                <div className="border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-100 flex items-center gap-2">
                      Online Payment Gateway
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setSettingsForm((prev) => ({ ...prev, gateway_enabled: !prev.gateway_enabled }))
                      }
                      className={`w-10 h-5 rounded-full border p-0.5 transition ${
                        settingsForm.gateway_enabled
                          ? 'border-amber-500 bg-amber-500'
                          : 'border-slate-600 bg-slate-800'
                      }`}
                    >
                      {settingsForm.gateway_enabled ? (
                        <ToggleRight className="w-3 h-3 ml-1 text-slate-900" />
                      ) : (
                        <ToggleLeft className="w-3 h-3 mr-1 text-slate-300" />
                      )}
                    </button>
                  </div>
                  {!settingsForm.gateway_enabled && (
                    <p className="text-xs text-slate-500 mb-4">
                      Enable Razorpay or Stripe integration readiness.
                    </p>
                  )}
                  {settingsForm.gateway_enabled && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                          Gateway Provider
                        </label>
                        <select
                          name="gateway_provider"
                          value={settingsForm.gateway_provider ?? 'razorpay'}
                          onChange={(e) =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              gateway_provider: e.target.value as 'razorpay' | 'stripe',
                            }))
                          }
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                        >
                          <option value="razorpay">Razorpay</option>
                          <option value="stripe">Stripe</option>
                        </select>
                      </div>
                      <p className="text-xs text-slate-500">
                        Gateway credentials are configured server-side; this flag enables the
                        online payment option in the customer checkout.
                      </p>
                    </div>
                  )}
                </div>

                {/* Cash Payment */}
                <div className="border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-100 flex items-center gap-2">
                      Cash Payment
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setSettingsForm((prev) => ({ ...prev, cash_enabled: !prev.cash_enabled }))
                      }
                      className={`w-10 h-5 rounded-full border p-0.5 transition ${
                        settingsForm.cash_enabled
                          ? 'border-amber-500 bg-amber-500'
                          : 'border-slate-600 bg-slate-800'
                      }`}
                    >
                      {settingsForm.cash_enabled ? (
                        <ToggleRight className="w-3 h-3 ml-1 text-slate-900" />
                      ) : (
                        <ToggleLeft className="w-3 h-3 mr-1 text-slate-300" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Allow customers to select 'Cash / Pay at Counter' at checkout.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Add / Edit item modal */}
      {openItemModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center no-print">
          <div className="absolute inset-0" onClick={() => setOpenItemModal(false)} aria-hidden="true" />
          <form
            onSubmit={handleSaveItem}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl mx-4"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-100">
                {editingItem ? 'Edit menu item' : 'Add menu item'}
              </h3>
              <button
                type="button"
                onClick={() => setOpenItemModal(false)}
                className="p-1 text-slate-400 hover:text-slate-100 rounded hover:bg-slate-800"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Name
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                  required
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Price (USD)
                </label>
                <input
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Description
              </label>
              <textarea
                name="description"
                value={form.description}
                onChange={handleFormChange}
                rows={3}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Category
                </label>
                <select
                  name="category"
                  value={form.category}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                >
                  {MENU_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Image URL
                </label>
                <input
                  name="image_url"
                  value={form.image_url}
                  onChange={handleFormChange}
                  placeholder="https://example.com/image.jpg"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:border-amber-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-400 shrink-0">
                Available
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({ ...prev, is_available: !prev.is_available }))
                }
                className={`w-10 h-5 rounded-full border p-0.5 transition ${
                  form.is_available
                    ? 'border-amber-500 bg-amber-500'
                    : 'border-slate-600 bg-slate-800'
                }`}
              >
                {form.is_available ? (
                  <ToggleRight className="w-3 h-3 ml-1 text-slate-900" />
                ) : (
                  <ToggleLeft className="w-3 h-3 mr-1 text-slate-300" />
                )}
              </button>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpenItemModal(false)}
                className="px-4 py-2.5 rounded-xl text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-60 transition"
              >
                {saving ? 'Saving…' : 'Save item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center no-print">
          <div className="absolute inset-0" onClick={() => setDeleteTargetId(null)} aria-hidden="true" />
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl max-w-sm mx-4">
            <h3 className="font-bold text-slate-100 mb-1">
              Delete menu item?
            </h3>
            <p className="text-sm text-slate-400 mb-6">
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTargetId(null)}
                className="px-4 py-2 rounded-xl text-slate-300 hover:text-slate-100 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteItem}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold disabled:opacity-60"
              >
                {saving ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
