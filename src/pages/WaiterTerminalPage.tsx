import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getTenantBySlug,
  getMenuItems,
  getOrders,
  createOrder,
  settlePayment,
  subscribeToOrders,
  subscribeToWaiterCalls,
} from '@/lib/supabase';
import type { MenuItem, Order, OrderItem, Tenant } from '@/types/database';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type TableStatus =
  | 'available'
  | 'seated'
  | 'cooking'
  | 'served'
  | 'bill_pending';

type OrderWithItems = Order & {
  order_items?: OrderItem[];
};

interface TableCardState {
  number: number;
  status: TableStatus;
  orderId: string | null;
  orderTotal: number;
  tipAmount: number;
  paymentMethod: string | null;
  paymentStatus: string | null;
  itemCount: number;
  lastUpdated: string;
}

interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes: string;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

function tableStatusFromOrder(order: Order | null): TableStatus {
  if (!order) return 'available';
  if (order.payment_status === 'pending' && order.payment_method) {
    return 'bill_pending';
  }
  switch (order.status) {
    case 'pending':
    case 'confirmed':
      return 'seated';
    case 'preparing':
      return 'cooking';
    case 'ready':
    case 'served':
      return 'served';
    case 'cancelled':
      return 'available';
    default:
      return 'available';
  }
}

function statusVariant(status: TableStatus): string {
  const variants: Record<TableStatus, string> = {
    available: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    seated: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    cooking: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
    served: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    bill_pending: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  };
  return `px-2 py-0.5 rounded text-xs font-semibold border ${variants[status]}`;
}

function statusLabel(status: TableStatus): string {
  const labels: Record<TableStatus, string> = {
    available: 'Available',
    seated: 'Seated / Ordering',
    cooking: 'Food Cooking',
    served: 'Food Served',
    bill_pending: 'Bill Pending',
  };
  return labels[status];
}

function statusIcon(status: TableStatus): React.ReactNode {
  const icons: Record<TableStatus, React.ReactNode> = {
    available: <CheckCircle2 className="w-3.5 h-3.5" />,
    seated: <Utensils className="w-3.5 h-3.5" />,
    cooking: <Flame className="w-3.5 h-3.5" />,
    served: <Bell className="w-3.5 h-3.5" />,
    bill_pending: <Clock className="w-3.5 h-3.5" />,
  };
  return icons[status];
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function WaiterTerminalPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  /* Data state */
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Modal state */
  const [activeTable, setActiveTable] = useState<number | null>(null);
  const [modalType, setModalType] = useState<'order' | 'notes' | 'settle' | null>(null);

  /* Order modal state */
  const [orderCategories, setOrderCategories] = useState<string[]>([]);
  const [selectedOrderCategory, setSelectedOrderCategory] = useState<string>('All');
  const [orderSearchQuery, setOrderSearchQuery] = useState<string>('');
  const [orderCart, setOrderCart] = useState<CartLine[]>([]);
  const [orderTableNotes, setOrderTableNotes] = useState<string>('');

  /* Notes modal state */
  const [notesInput, setNotesInput] = useState<string>('');

  /* Feedback state */
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Derived: map table number -> latest order */
  const tablesByNumber = useMemo(() => {
    const map = new Map<number, OrderWithItems | null>();
    for (let n = 1; n <= 12; n += 1) {
      map.set(n, null);
    }
    orders.forEach((order) => {
      const n = Number(order.table_number);
      if (Number.isFinite(n) && n >= 1 && n <= 12) {
        const existing = map.get(n) ?? null;
        if (
          !existing ||
          new Date(order.created_at) > new Date(existing.created_at)
        ) {
          map.set(n, order as OrderWithItems);
        }
      }
    });
    return map;
  }, [orders]);

  const tableStates = useMemo(() => {
    const states: TableCardState[] = [];
    for (let n = 1; n <= 12; n += 1) {
      const order = tablesByNumber.get(n);
      states.push({
        number: n,
        status: tableStatusFromOrder(order ?? null),
        orderId: order?.id ?? null,
        orderTotal: order?.total ?? 0,
        tipAmount: order?.tip_amount ?? 0,
        paymentMethod: order?.payment_method ?? null,
        paymentStatus: order?.payment_status ?? null,
        itemCount: order?.order_items?.length ?? 0,
        lastUpdated: order?.created_at ?? '',
      });
    }
    return states;
  }, [tablesByNumber]);

  const [tableSearch, setTableSearch] = useState('');

  const filteredTables = tableStates.filter(
    (t) =>
      !tableSearch ||
      String(t.number).includes(tableSearch) ||
      statusLabel(t.status).toLowerCase().includes(tableSearch.toLowerCase()),
  );

  const orderCartTotal = useMemo(
    () => orderCart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [orderCart],
  );

  /* Data loading */
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!tenantSlug) {
      setError('No tenant in URL');
      setLoading(false);
      return;
    }
    try {
      const { data: tenantData, error: tenantErr } = await getTenantBySlug(
        tenantSlug,
      );
      if (tenantErr) throw tenantErr;
      if (!tenantData) {
        setError(`Tenant "${tenantSlug}" not found`);
        setLoading(false);
        return;
      }
      setTenant(tenantData);

      const [{ data: ordersData, error: ordersErr }, { data: items, error: itemsErr }] =
        await Promise.all([getOrders(tenantData.id), getMenuItems(tenantData.id, true)]);

      if (ordersErr) throw ordersErr;
      if (itemsErr) throw itemsErr;
      setOrders(ordersData ?? []);
      setMenuItems(items ?? []);

      const cats = Array.from(
        new Set((items as MenuItem[] ?? []).map((i) => i.category)),
      );
      setOrderCategories(['All', ...cats]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load terminal');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* Toast */
  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success', duration = 3000) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type });
      timerRef.current = setTimeout(() => setToast(null), duration);
    },
    [],
  );

  /* Real-time subscriptions */
  useEffect(() => {
    if (!tenant?.id) return;
    const ordersSub = subscribeToOrders(tenant.id, () => {
      void loadData();
    });
    const callsSub = subscribeToWaiterCalls(tenant.id, () => {
      void loadData();
    });
    return () => {
      ordersSub.unsubscribe();
      callsSub.unsubscribe();
    };
  }, [tenant?.id, loadData]);

  /* ---- Order modal ---- */
  const openOrderModal = (n: number) => {
    setActiveTable(n);
    setModalType('order');
    setOrderCart([]);
    setOrderTableNotes('');
    setSelectedOrderCategory('All');
    setOrderSearchQuery('');
  };

  const closeOrderModal = () => {
    setModalType(null);
    setActiveTable(null);
    setOrderCart([]);
    setOrderTableNotes('');
  };

  const filteredOrderItems = useMemo(() => {
    const q = orderSearchQuery.toLowerCase().trim();
    return menuItems.filter((item) => {
      const matchCat = selectedOrderCategory === 'All' || item.category === selectedOrderCategory;
      const matchSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.description ?? '').toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [menuItems, selectedOrderCategory, orderSearchQuery]);

  const addOrderItem = (item: MenuItem) => {
    const existing = orderCart.find((l) => l.menuItemId === item.id);
    if (existing) {
      setOrderCart(
        orderCart.map((l) =>
          l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        ),
      );
    } else {
      setOrderCart([...orderCart, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1, notes: '' }]);
    }
  };

  const removeOrderItem = (menuItemId: string) => {
    setOrderCart(orderCart.filter((l) => l.menuItemId !== menuItemId));
  };

  const submitOrder = async () => {
    if (!tenant || !activeTable) return;
    if (orderCart.length === 0) {
      showToast('Please add at least one item', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { data: order, error: orderErr } = await createOrder({
        tenant_id: tenant.id,
        table_number: activeTable,
        total: orderCartTotal,
        tip_amount: 0,
        payment_method: null,
        payment_status: 'pending',
        customer_name: null,
        order_type: 'dine-in',
        items: orderCart.map((line) => ({
          menu_item_id: line.menuItemId,
          quantity: line.quantity,
          unit_price: line.price,
          notes: line.notes || null,
          customizations: null,
        })),
      });
      if (orderErr) throw orderErr;

      // Add verbal notes if provided
      if (orderTableNotes.trim()) {
        await (globalThis as any).supabase?.from('orders').update(
          { customer_name: orderTableNotes.trim() },
          { eq: { id: order.id } },
        );
      }

      showToast(`Table ${activeTable} order fired to kitchen`, 'success');
      closeOrderModal();
      // Force-refresh table status so the grid reflects Seated/Cooking immediately
      void loadData();
    } catch (err) {
      showToast('Failed to place order', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- Notes modal ---- */
  const openNotesModal = (n: number) => {
    const order = tablesByNumber.get(n);
    setActiveTable(n);
    setModalType('notes');
    setNotesInput(order?.customer_name ?? '');
  };

  const closeNotesModal = () => {
    setModalType(null);
    setActiveTable(null);
    setNotesInput('');
  };

  const saveNotes = async () => {
    if (!tenant || !activeTable) return;
    setSubmitting(true);
    try {
      const order = tablesByNumber.get(activeTable);
      if (!order) {
        showToast('No active order for this table', 'error');
        closeNotesModal();
        return;
      }
      const { error: updErr } = await (globalThis as any).supabase
        .from('orders')
        .update({ customer_name: notesInput.trim() || null })
        .eq('id', order.id);
      if (updErr) throw updErr;
      showToast('Table notes updated', 'success');
      closeNotesModal();
    } catch (err) {
      showToast('Failed to save notes', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- Settle modal ---- */
  const openSettleModal = (n: number) => {
    setActiveTable(n);
    setModalType('settle');
  };

  const closeSettleModal = () => {
    setModalType(null);
    setActiveTable(null);
  };

  const settleTable = async () => {
    if (!tenant || !activeTable) return;
    setSubmitting(true);
    try {
      const order = tablesByNumber.get(activeTable);
      if (!order) {
        showToast('No active order for this table', 'error');
        closeSettleModal();
        return;
      }
      const { error: settleErr } = await settlePayment(order.id, null);
      if (settleErr) throw settleErr;
      showToast(`Table ${activeTable} settled and cleared`, 'success');
      closeSettleModal();
    } catch (err) {
      showToast('Failed to settle table', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---- Empty / Error states ---- */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-amber-500" aria-label="Loading" />
        <p className="text-sm">Loading Waiter Terminal…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans p-6 text-center">
        <AlertCircle className="w-8 h-8 mb-3 text-rose-500" aria-label="Error" />
        <h2 className="text-slate-200 font-semibold mb-2">Terminal Unavailable</h2>
        <p className="text-sm text-slate-400 mb-6">{error}</p>
        <button
          onClick={() => {
            setError(null);
            void loadData();
          }}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!tenant) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased p-2 md:p-4">
      {/* Header */}
      <header className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100">
              {tenant.name} — Waiter Terminal
            </h1>
            <p className="text-xs text-slate-400">
              Table {activeTable ?? '—'} • Staff POS
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:block text-xs text-slate-500">Tables Active</span>
          <span className="text-2xl font-black text-amber-400">
            {filteredTables.filter((t) => t.status !== 'available').length}
          </span>
        </div>
      </header>

      {/* Table search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search tables…"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition"
          />
        </div>
      </div>

      {/* Table Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-3">
        {filteredTables.map((table) => (
          <div
            key={table.number}
            className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md flex flex-col justify-between min-h-[140px] hover:border-amber-500/50 transition group"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="text-2xl font-black text-slate-100">{table.number}</span>
                <span
                  className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold ${statusVariant(table.status)}`}
                >
                  {statusIcon(table.status)} {statusLabel(table.status)}
                </span>
              </div>
              {table.orderId && (
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <ShoppingBag className="w-3 h-3" />
                  <span>{table.itemCount} items</span>
                </div>
              )}
            </div>

            {table.orderId && (
              <div className="flex-1 space-y-2">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs font-medium text-slate-300">Bill</span>
                  <span className="text-sm font-bold text-amber-400">
                    ₹{formatPrice(table.orderTotal + table.tipAmount)}
                  </span>
                </div>
                {table.tipAmount > 0 && (
                  <div className="flex justify-between items-baseline text-xs">
                    <span className="text-slate-500">Tip</span>
                    <span className="text-amber-400 font-medium">₹{formatPrice(table.tipAmount)}</span>
                  </div>
                )}
                {table.paymentMethod && (
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <span>{table.paymentMethod}</span>
                    <span className="px-1 py-0.5 rounded bg-slate-800 text-[10px]">
                      {table.paymentStatus}
                    </span>
                  </div>
                )}
                <span className="text-[10px] text-slate-500">
                  {table.lastUpdated ? new Date(table.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
            )}

            <div className="mt-3 pt-2 border-t border-slate-800/50 flex gap-2">
              {table.status === 'available' ? (
                <button
                  onClick={() => openOrderModal(table.number)}
                  disabled={submitting}
                  className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition disabled:opacity-60 flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Take Order
                </button>
              ) : (
                <>
                  <button
                    onClick={() => openNotesModal(table.number)}
                    disabled={submitting}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition disabled:opacity-60"
                  >
                    Notes
                  </button>
                  {table.status === 'served' || table.status === 'bill_pending' ? (
                    <button
                      onClick={() => openSettleModal(table.number)}
                      disabled={submitting}
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg transition disabled:opacity-60"
                    >
                      Settle
                    </button>
                  ) : (
                    <button
                      onClick={() => openSettleModal(table.number)}
                      disabled={submitting}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition disabled:opacity-60 opacity-50 cursor-not-allowed"
                    >
                      Settle
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Order Modal */}
      {modalType === 'order' && activeTable && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={closeOrderModal} aria-hidden="true" />
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="p-5 border-b border-slate-800 flex justify-between items-start">
              <div>
                <h2 className="text-lg font-bold text-slate-100">
                  Take Order — Table {activeTable}
                </h2>
                <p className="text-xs text-slate-400">Quick-select items to fire to KDS</p>
              </div>
              <button onClick={closeOrderModal} className="p-2 text-slate-400 hover:text-slate-100 rounded hover:bg-slate-800">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Category chips */}
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {orderCategories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedOrderCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                      selectedOrderCategory === cat
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search items…"
                  value={orderSearchQuery}
                  onChange={(e) => setOrderSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              {/* Items grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredOrderItems.length === 0 ? (
                  <p className="col-span-2 text-center text-slate-500 text-sm py-6">No items found</p>
                ) : (
                  filteredOrderItems.map((item) => (
                    <div
                      key={item.id}
                      className="bg-slate-800 border border-slate-700 rounded-xl p-3 flex flex-col"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-sm text-slate-100">{item.name}</h4>
                        <span className="text-xs font-bold text-amber-400">₹{formatPrice(item.price)}</span>
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2 mb-2">{item.description ?? ''}</p>
                      <div className="mt-auto pt-2 border-t border-slate-800/50 flex items-center justify-between">
                        <button
                          onClick={() => addOrderItem(item)}
                          disabled={submitting}
                          className="flex-1 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/30 rounded-lg transition disabled:opacity-50"
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Cart summary */}
              {orderCart.length > 0 && (
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-semibold text-slate-400 uppercase">Order Cart</span>
                    <span className="text-xs font-bold text-slate-300">{orderCart.reduce((s, l) => s + l.quantity, 0)} items</span>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {orderCart.map((line) => (
                      <div key={line.menuItemId} className="flex justify-between items-center py-2 border-b border-slate-800/50 last:border-0">
                        <div className="flex-1">
                          <span className="text-sm font-medium text-slate-200">{line.name}</span>
                          <span className="text-xs text-slate-500 block">₹{formatPrice(line.price * line.quantity)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setOrderCart(orderCart.map((l) =>
                                l.menuItemId === line.menuItemId
                                  ? { ...l, quantity: Math.max(1, l.quantity - 1) }
                                  : l,
                              ));
                            }}
                            className="p-1 hover:bg-slate-700 rounded text-slate-400"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-bold text-slate-100 px-1.5">{line.quantity}</span>
                          <button
                            onClick={() => {
                              setOrderCart(orderCart.map((l) =>
                                l.menuItemId === line.menuItemId
                                  ? { ...l, quantity: l.quantity + 1 }
                                  : l,
                              ));
                            }}
                            className="p-1 hover:bg-slate-700 rounded text-slate-400"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeOrderItem(line.menuItemId)}
                          className="p-1 hover:bg-rose-900/50 text-rose-400 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-800">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-300">Total</span>
                      <span className="text-lg font-bold text-amber-400">₹{formatPrice(orderCartTotal)}</span>
                    </div>
                    <div className="mt-2">
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Verbal Notes (optional)</label>
                      <textarea
                        value={orderTableNotes}
                        onChange={(e) => setOrderTableNotes(e.target.value)}
                        rows={2}
                        placeholder="e.g. Allergic to nuts"
                        className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={submitOrder}
                    disabled={submitting}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Firing to Kitchen…' : 'Send Order to KDS'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {modalType === 'notes' && activeTable && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={closeNotesModal} aria-hidden="true" />
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-slate-100">Add Verbal Notes</h2>
              <button onClick={closeNotesModal} className="p-2 text-slate-400 hover:text-slate-100 rounded hover:bg-slate-800">
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-4">Table {activeTable}</p>
            <textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              rows={4}
              placeholder="e.g. Allergic to nuts, no onions, extra spicy"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none transition"
            />
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeNotesModal}
                className="px-4 py-2 rounded-xl text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveNotes}
                disabled={submitting}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-60 transition"
              >
                {submitting ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settle Modal */}
      {modalType === 'settle' && activeTable && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="absolute inset-0" onClick={closeSettleModal} aria-hidden="true" />
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-bold text-slate-100">Settle &amp; Clear Table</h2>
              <button onClick={closeSettleModal} className="p-2 text-slate-400 hover:text-slate-100 rounded hover:bg-slate-800">
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-4">Table {activeTable}</p>

            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-slate-400 text-sm">Bill Total</span>
                <span className="text-sm font-bold text-amber-400">
                  ₹{formatPrice(
                    (tablesByNumber.get(activeTable!)?.total ?? 0) +
                      (tablesByNumber.get(activeTable!)?.tip_amount ?? 0),
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-sm">Tip</span>
                <span className="text-sm font-bold text-amber-400">
                  ₹{formatPrice(tablesByNumber.get(activeTable!)?.tip_amount ?? 0)}
                </span>
              </div>
            </div>

            <p className="text-sm text-slate-400 mb-6">
              Marking this table as settled will reset it to Available status.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeSettleModal}
                className="px-4 py-2 rounded-xl text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={settleTable}
                disabled={submitting}
                className="px-5 py-2 bg-rose-500 hover:bg-rose-400 text-white font-bold rounded-xl shadow-lg shadow-rose-500/20 disabled:opacity-60 transition"
              >
                {submitting ? 'Settling…' : 'Settle & Clear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center">
          <div
            className={`px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border text-sm font-medium backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-emerald-900/90 text-emerald-100 border-emerald-500/50'
                : 'bg-rose-900/90 text-rose-100 border-rose-500/50'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-5 h-5" aria-hidden="true" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
