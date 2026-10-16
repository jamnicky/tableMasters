import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getTenantBySlug,
  getMenuItems,
  getOrders,
  createOrder,
  subscribeToOrders,
  subscribeToWaiterCalls,
} from '@/lib/supabase';
import type { MenuItem, Order, OrderItem, Tenant, TenantSettings } from '@/types/database';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Loader2,
  Mic,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Utensils,
  X,
  Zap,
} from 'lucide-react';

type TableStatus = 'available' | 'seated' | 'cooking' | 'served' | 'bill_pending';

type OrderWithItems = Order & {
  order_items?: OrderItem[];
};

interface CartLine {
  menuItemId: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  notes: string;
  veg: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

function formatPrice(cents: number, symbol: string = '$'): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${symbol}${whole}.${frac.toString().padStart(2, '0')}`;
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

export function WaiterTerminalPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTable, setActiveTable] = useState<number | null>(null);
  const [rushMode, setRushMode] = useState(false);

  const [orderCart, setOrderCart] = useState<CartLine[]>([]);
  const [cookingNotes, setCookingNotes] = useState<string>('');
  const [specialTags, setSpecialTags] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All Items');

  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [notesItemId, setNotesItemId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const orderCartTotal = useMemo(
    () => orderCart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [orderCart]
  );

  const currencySymbol = useMemo(() => tenantSettings?.currency_symbol ?? '₹', [tenantSettings]);

  const itemCount = useMemo(
    () => orderCart.reduce((sum, line) => sum + line.quantity, 0),
    [orderCart]
  );

  const previewTicker = useMemo(() => {
    const counts: Record<string, number> = {};
    orderCart.forEach((line) => {
      counts[line.name] = (counts[line.name] ?? 0) + line.quantity;
    });
    return Object.entries(counts).map(([name, qty]) => `${qty}x ${name}`).join(', ');
  }, [orderCart]);

  const CATEGORY_CHIPS = [
    'All Items',
    'Dum Biryani',
    'Tandoor & Breads',
    'Curries',
    'Indo-Chinese',
    'Starters',
    'Beverages & Desserts',
  ];

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!tenantSlug) {
      setError('No tenant in URL');
      setLoading(false);
      return;
    }
    try {
      const { data: tenantData, error: tenantErr } = await getTenantBySlug(tenantSlug);
      if (tenantErr) throw tenantErr;
      if (!tenantData) {
        setError(`Tenant "${tenantSlug}" not found`);
        setLoading(false);
        return;
      }
      setTenant(tenantData);

      const [{ data: items, error: itemsErr }, { data: settings, error: settingsErr }] =
        await Promise.all([getOrders(tenantData.id), getMenuItems(tenantData.id, true), getTenantSettings(tenantData.id)]);
      if (itemsErr) throw itemsErr;
      setMenuItems(items ?? []);
      setTenantSettings(settings ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load terminal');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success', duration = 3000) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type });
      timerRef.current = setTimeout(() => setToast(null), duration);
    },
    [],
  );

  useEffect(() => {
    if (!tenant?.id) return;
    const ordersSub = subscribeToOrders(tenant.id, () => void loadData());
    const callsSub = subscribeToWaiterCalls(tenant.id, () => void loadData());
    return () => {
      ordersSub.unsubscribe();
      callsSub.unsubscribe();
    };
  }, [tenant?.id, loadData]);

  const filteredMenuItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return menuItems.filter((item) => {
      const matchCat = selectedCategory === 'All Items' || item.category === selectedCategory;
      const matchSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  const tablesByNumber = useMemo(() => {
    const map = new Map<number, OrderWithItems | null>();
    for (let n = 1; n <= 12; n += 1) {
      map.set(n, null);
    }
    orders.forEach((order) => {
      const n = Number(order.table_number);
      if (Number.isFinite(n) && n >= 1 && n <= 12) {
        const existing = map.get(n) ?? null;
        if (!existing || new Date(order.created_at) > new Date(existing.created_at)) {
          map.set(n, order as OrderWithItems);
        }
      }
    });
    return map;
  }, [orders]);

  const pendingOrders = orders.filter((o) => o.status === 'pending' && o.payment_status === 'pending');

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

  const addToCart = (item: MenuItem) => {
    const sku = item.id.slice(0, 4).toUpperCase();
    const existing = orderCart.find((l) => l.menuItemId === item.id);
    if (existing) {
      setOrderCart(orderCart.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l)));
    } else {
      setOrderCart([...orderCart, { menuItemId: item.id, sku, name: item.name, price: item.price, quantity: 1, notes: '', veg: true }]);
    }
  };

  const changeQty = (menuItemId: string, delta: number) => {
    setOrderCart(
      orderCart.map((l) => (l.menuItemId !== menuItemId ? l : { ...l, quantity: l.quantity + delta > 0 ? l.quantity + delta : 1 })).filter((l): l is CartLine => l.quantity > 0),
    );
  };

  const toggleSpecialTag = (tag: string) => {
    setSpecialTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const clearCart = () => {
    setOrderCart([]);
    setCookingNotes('');
    setSpecialTags([]);
  };

  const fireKOT = async () => {
    if (!tenant || !activeTable) return;
    if (orderCart.length === 0) {
      showToast('Please add at least one item', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { error: orderErr } = await createOrder({
        tenant_id: tenant.id,
        table_number: activeTable,
        total: orderCartTotal,
        tip_amount: 0,
        payment_method: null,
        payment_status: 'pending',
        customer_name: specialTags.length > 0 || cookingNotes.trim() ? `${cookingNotes.trim()} ${specialTags.join(' ')}`.trim() : null,
        order_type: 'dine-in',
        items: orderCart.map((line) => ({ menu_item_id: line.menuItemId, quantity: line.quantity, unit_price: line.price, notes: line.notes || null, customizations: null })),
      });
      if (orderErr) throw orderErr;

      showToast(`KOT fired to kitchen for Table ${activeTable}`, 'success');
      clearCart();
      setActiveTable(null);
      void loadData();
    } catch (err) {
      showToast('Failed to fire KOT', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const draftOrder = () => {
    showToast('Order saved as draft', 'success');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f9f9ff] text-[#5a4138] flex items-center justify-center font-sans">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#006c49]" aria-label="Loading" />
        <p className="text-sm">Loading Waiter Terminal…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f9f9ff] text-[#5a4138] flex items-center justify-center font-sans p-6 text-center">
        <AlertCircle className="w-8 h-8 mb-3 text-rose-500" aria-label="Error" />
        <h2 className="text-[#111c2d] font-semibold mb-2">Terminal Unavailable</h2>
        <p className="text-sm text-[#5a4138] mb-6">{error}</p>
        <button onClick={() => { setError(null); void loadData(); }} className="px-4 py-2 bg-[#006c49] hover:bg-[#005236] text-white font-bold rounded-xl transition">
          Retry
        </button>
      </div>
    );
  }

  if (!tenant) return null;

  return (
    <div className="min-h-screen bg-[#f9f9ff] text-[#111c2d] font-sans antialiased pb-24">
      {/* ============ HEADER & TABLE CONTEXT ============ */}
      <header className="fixed top-0 w-full z-40 bg-white/85 backdrop-blur-xl border-b border-[#e2bfb2]/30 px-4 md:px-6 py-4 no-print">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#006c49] animate-pulse" />
              <span className="text-[10px] uppercase font-bold tracking-wider text-[#006c49]">Floor Active</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#5a4138]">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#006c49] animate-pulse" /><span>KDS Live Sync</span></span>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-[#111c2d]">Capt. Karthik R.</p>
              <p className="text-[10px] text-[#5a4138]">Zone B • Main Hall</p>
            </div>
          </div>
          <div className="bg-white p-3 rounded-xl border border-[#e2bfb2]/30 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-[#ffdbce] flex items-center justify-center text-[#370e00] font-bold text-xs">CK</span>
                <div>
                  <h2 className="text-base font-bold text-[#111c2d]">Table Switcher</h2>
                  <p className="text-xs text-[#5a4138]">Selected: <span className="font-bold text-[#a33900]">Table {activeTable ?? 14}</span>{' • 4 Guests'}</p>
                </div>
              </div>
              <button onClick={() => setActiveTable(activeTable ?? 14)} className="px-3 py-1.5 bg-[#006c49] hover:bg-[#005236] text-white text-xs font-bold rounded-lg transition">Switch Table</button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 md:px-6 pt-20 pb-24">
          {/* ============ MODE BANNER ============ */}
          <section className="mb-6">
            <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-[#e2bfb2]/30 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#ffdbce] text-[#370e00] rounded-lg"><ShoppingBag className="w-5 h-5" /></div>
                <div>
                  <h3 className="text-sm font-bold text-[#111c2d] uppercase tracking-wider">Tableside Punch (Manual KOT)</h3>
                  <p className="text-[10px] text-[#5a4138]">Quick order entry for captain-assisted tables</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" checked={rushMode} onChange={() => setRushMode(!rushMode)} className="peer sr-only" />
                  <span className="w-8 h-4 rounded-full bg-[#e2bfb2] peer-checked:bg-[#a33900] after:peer-checked:translate-x-full after:transition after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:w-3 after:h-3" />
                  <span className="text-xs font-bold text-[#5a4138] group-hover:text-[#a33900] transition">Rush Starters 🔥</span>
                </label>
              </div>
            </div>
          </section>

          {/* ============ NEW ORDERS TO REVIEW ============ */}
          <section className="mb-6">
            <div className="bg-white p-4 rounded-xl border border-[#e2bfb2]/30 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-[#111c2d] uppercase tracking-wider flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#006c49]" /> New Orders to Review
                </h3>
                <span className="text-xs font-bold text-[#a33900] bg-[#ffdbce] px-2 py-1 rounded">{pendingOrders.length}</span>
              </div>
              <div className="space-y-2">
                {pendingOrders.length === 0 ? (
                  <p className="text-center text-sm text-[#5a4138] py-4">No new orders</p>
                ) : (
                  pendingOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between p-3 bg-[#f0f3ff] rounded-xl border border-[#e2bfb2]/30">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold text-[#653e00]">#{order.id.slice(0, 4).toUpperCase()}</span>
                          <span className="text-xs font-bold text-[#111c2d] truncate">{order.table_number}</span>
                        </div>
                        <span className="text-sm font-bold text-[#111c2d]">{formatPrice(order.total + (order.tip_amount ?? 0), currencySymbol)}</span>
                      </div>
                      <button onClick={() => setActiveTable(typeof order.table_number === 'string' ? parseInt(order.table_number.replace('Table ', '')) || 1 : order.table_number)} className="flex-1 py-2 bg-[#006c49] hover:bg-[#005236] text-white text-xs font-bold rounded-lg transition">Take Order</button>
                    </div>
                  ))}
                )}
              </div>
            </section>

            {/* ============ SEARCH & CATEGORY FILTERS ============ */}
            <section className="mb-6">
              <div className="bg-white p-4 rounded-xl border border-[#e2bfb2]/30 shadow-sm">
                <div className="flex items-end gap-3 mb-3">
                  <div className="flex-1 relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a4138]"><Search className="w-4 h-4" /></div>
                    <input type="search" placeholder="Search dish or code (e.g. #B02, Naan)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-10 py-2.5 bg-[#f0f3ff] border border-[#e2bfb2]/30 rounded-xl text-[#111c2d] placeholder-[#5a4138]/60 focus:outline-none focus:ring-2 focus:ring-[#006c49]/30 transition" />
                    <button onClick={() => showToast('Voice input not available in demo', 'error')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-[#f0f3ff] hover:bg-[#e2bfb2] rounded-full text-[#5a4138] hover:text-[#a33900] transition" aria-label="Voice dictation"><Mic className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                  {CATEGORY_CHIPS.map((cat) => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-3 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${selectedCategory === cat ? 'bg-[#006c49] text-white shadow-md shadow-[#006c49]/30' : 'bg-[#f0f3ff] text-[#5a4138] hover:bg-[#e2bfb2]'}`}>{cat}</button>
                  ))}
                </div>
              </div>
            </section>

            {/* ============ RAPID TOUCH ITEM ROWS ============ */}
            <section className="mb-8">
              <div className="bg-white rounded-xl border border-[#e2bfb2]/30 shadow-sm overflow-hidden">
                <div className="overflow-y-auto max-h-[60vh] pr-1">
                  {filteredMenuItems.length === 0 ? (
                    <div className="p-8 text-center text-[#5a4138]"><p className="text-sm">No items match your filters.</p></div>
                  ) : (
                    filteredMenuItems.map((item) => {
                      const sku = item.id.slice(0, 4).toUpperCase();
                      const cartLine = orderCart.find((l) => l.menuItemId === item.id);
                      const inCart = !!cartLine;
                      const qty = cartLine?.quantity ?? 0;
                      return (
                        <div key={item.id} className="flex items-center justify-between px-4 py-3 border-b border-[#e2bfb2]/20 last:border-0 hover:bg-[#f0f3ff]/50 transition group">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-[#f0f3ff] flex items-center justify-center text-[#006c49] text-xs font-bold overflow-hidden">
                              {item.image_url ? <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" /> : <span className="font-bold">{sku.charAt(0)}</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[10px] font-mono font-bold text-[#653e00]">#{sku}</span>
                                <span className="text-xs font-bold text-[#111c2d] truncate">{item.name}</span>
                                {item.is_available ? null : (<span className="text-[10px] font-bold text-rose-500">Unavailable</span>)}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-[#5a4138]">
                                <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-[#006c49]" /><span>Veg</span></span>
                                {item.description && (
                                  <span className="flex items-center gap-1"><span className="line-clamp-1">{item.description}</span></span>
                                )}
                              </div>
                            </div>
                            <span className="text-sm font-bold text-[#111c2d] whitespace-nowrap">{formatPrice(item.price, currencySymbol)}</span>
                          </div>

                          {/* Action: Pill stepper or ADD button */}
                          <div className="flex items-center gap-2">
                            {inCart ? (
                              <div className="flex items-center gap-1 bg-[#f0f3ff] rounded-full px-2 py-1 border border-[#e2bfb2]/30">
                                <button onClick={() => changeQty(item.id, -1)} disabled={qty <= 1 || submitting} className="p-1 hover:bg-[#d97706]/10 rounded text-[#006c49] disabled:opacity-50"><Minus className="w-3 h-3" /></button>
                                <span className="w-4 text-center text-xs font-bold text-[#111c2d]">{qty}</span>
                                <button onClick={() => changeQty(item.id, 1)} disabled={submitting} className="p-1 hover:bg-[#d97706]/10 rounded text-[#006c49] disabled:opacity-50"><Plus className="w-3 h-3" /></button>
                              </div>
                            ) : (
                              <button onClick={() => addToCart(item)} disabled={!item.is_available || submitting} className="px-3 py-1.5 bg-[#006c49] hover:bg-[#005236] text-white text-xs font-bold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed">ADD</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </main>

            {/* ============ PERSISTENT FLOATING CART & KITCHEN FIRE BAR ============ */}
            <div className="fixed bottom-0 left-0 right-0 z-50 no-print">
              <div className={`bg-white border-t border-[#e2bfb2]/30 shadow-2xl p-4 md:p-6 ${orderCart.length === 0 ? 'translate-y-full' : ''} transition-transform duration-300 ease-in-out`}>
                <div className="max-w-7xl mx-auto">
                  {/* Quick preview ticker */}
                  {itemCount > 0 && (
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs text-[#5a4138]">
                        <span className="font-bold text-[#006c49]">{itemCount}</span>
                        <span>item{itemCount === 1 ? '' : 's'} in cart</span>
                      </div>
                      <div className="flex-1 overflow-hidden whitespace-nowrap text-[11px] font-bold text-[#a33900] animate-[marquee_3s_linear_infinite]">{previewTicker}</div>
                      <span className="text-sm font-black text-[#111c2d]">{formatPrice(orderCartTotal, currencySymbol)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={draftOrder} disabled={orderCart.length === 0 || submitting} className={`flex-1 py-3.5 rounded-xl text-xs font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${orderCart.length === 0 ? 'bg-[#f0f3ff] border border-[#e2bfb2]/30 text-[#5a4138]' : 'bg-[#ffdbce] text-[#370e00] shadow-md shadow-[#ffdbce]/30'`}>Draft</button>
                    <button onClick={fireKOT} disabled={orderCart.length === 0 || submitting} className={`flex-2 py-3.5 bg-[#006c49] hover:bg-[#005236] text-white text-xs font-bold shadow-lg shadow-[#006c49]/20 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}><Zap className="w-4 h-4" /><span>🔥 Fire KOT to Kitchen →</span></button>
                  </div>
                </div>
              </div>
            </div>

            {/* ============ Bottom Navigation ============ */}
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#e2bfb2]/30 shadow-lg">
              <div className="max-w-7xl mx-auto h-12 flex items-center justify-between px-6">
                <button onClick={() => setActiveTable(null)} className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs font-bold transition rounded-t-lg ${!activeTable ? 'bg-[#f0f3ff] text-[#006c49]' : 'text-[#5a4138] hover:bg-[#f0f3ff]'}`}>
                  <div className="w-5 h-5 rounded-full bg-[#f0f3ff] flex items-center justify-center text-[#006c49] text-xs font-bold mr-1 mb-0.5">🍽️</div>
                  <span>Tables</span>
                </button>
                <button onClick={() => setActiveTable(null)} className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs font-bold transition rounded-t-lg ${activeTable ? 'bg-[#f0f3ff] text-[#006c49]' : 'text-[#5a4138] hover:bg-[#f0f3ff]'}`}>
                  <div className="w-5 h-5 rounded-full bg-[#f0f3ff] flex items-center justify-center text-[#006c49] text-xs font-bold mr-1 mb-0.5">🍳</div>
                  <span>Active Orders</span>
                </button>
                <button onClick={() => setActiveTable(null)} className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs font-bold transition rounded-t-lg ${activeTable ? 'bg-[#006c49] text-white' : 'text-[#5a4138] hover:bg-[#f0f3ff]'}`}>
                  <div className="w-5 h-5 rounded-full bg-[#f0f3ff] flex items-center justify-center text-[#006c49] text-xs font-bold mr-1 mb-0.5">🔥</div>
                  <span>Hot Pass</span>
                </button>
              </div>
            </div>

            {/* Toast */}
            {toast && (
              <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] flex items-center no-print">
                <div className={`px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border text-sm font-medium backdrop-blur-md ${toast.type === 'success' ? 'bg-emerald-900/90 text-emerald-100 border-emerald-500/50' : 'bg-rose-900/90 text-rose-100 border-rose-500/50'}`}>
                  {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> : <AlertCircle className="w-5 h-5" aria-hidden="true" />}
                  <span>{toast.message}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
