import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  createOrder,
  createWaiterCall,
  getMenuItems,
  getOrders,
  getTenantBySlug,
  getTenantSettings,
  hasSupabaseConfig,
  settlePayment,
} from '@/lib/supabase';
import type { MenuItem, Tenant, TenantSettings } from '@/types/database';
import {
  AlertCircle,
  Bell,
  ChevronRight,
  CircleCheck,
  Copy,
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
/* Customization types                                                        */
/* -------------------------------------------------------------------------- */

interface CustomizationOption {
  name: string;
  priceDelta: number; // in minor currency units (cents)
}

interface CustomizationGroup {
  group: string;
  type: 'single' | 'multi';
  options: CustomizationOption[];
}

interface SelectedCustomization {
  group: string;
  option: string;
  priceDelta: number;
}

interface CartItem {
  id: string; // stable cart line key: menuItemId + customization fingerprint
  menuItemId: string;
  name: string;
  price: number; // unit price including customization deltas
  quantity: number;
  selections: SelectedCustomization[];
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

function normalizeOption(value: unknown): CustomizationOption {
  if (typeof value === 'string') {
    return { name: value, priceDelta: 0 };
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return {
      name: String(obj.name ?? ''),
      priceDelta:
        typeof obj.price_delta === 'number'
          ? obj.price_delta
          : typeof obj.priceDelta === 'number'
            ? obj.priceDelta
            : 0,
    };
  }
  return { name: '', priceDelta: 0 };
}

/**
 * Parse the `customization_options` JSON string on a menu item into
 * normalized customization groups. Tolerates several shapes:
 *   - { "Doneness": ["Rare", "Medium"], "Extras": ["Cheese", "Bacon"] }
 *   - [ { group: "Doneness", type: "single", options: ["Rare", "Medium"] } ]
 *   - options as objects: { name: "Cheese", price_delta: 100 }
 */
function parseCustomizationOptions(raw: string | null): CustomizationGroup[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const groups: CustomizationGroup[] = [];

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const groupName = String(e.group ?? e.name ?? '');
        const rawOpts = Array.isArray(e.options) ? e.options : [];
        groups.push({
          group: groupName,
          type: e.type === 'multi' ? 'multi' : 'single',
          options: rawOpts.map(normalizeOption),
        });
      }
      return groups;
    }

    if (parsed !== null && typeof parsed === 'object') {
      for (const [groupName, value] of Object.entries(parsed as Record<string, unknown>)) {
        groups.push({
          group: groupName,
          type: 'single',
          options: Array.isArray(value) ? value.map(normalizeOption) : [],
        });
      }
      return groups;
    }
  } catch {
    // malformed JSON — treat as no customizations
  }
  return [];
}

function cartLineId(menuItemId: string, selections: SelectedCustomization[]): string {
  const fingerprint = JSON.stringify(
    [...selections]
      .sort((a, b) => a.group.localeCompare(b.group) || a.option.localeCompare(b.option))
      .map((sel) => `${sel.group}:${sel.option}`),
  );
  return `${menuItemId}::${fingerprint}`;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function MenuPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();

  /* Data state */
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Cart state */
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  /* Table number state (from ?table= query param, default "Table 4") */
  const [tableNumber, setTableNumber] = useState<string>('Table 4');
  const [isTableOpen, setIsTableOpen] = useState(false);

  /* Item detail modal state */
  const [modalItem, setModalItem] = useState<MenuItem | null>(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [modalSelections, setModalSelections] = useState<Record<string, string[]>>({});
  const [modalNotes, setModalNotes] = useState('');

  /* Tip state */
  const [tipPercent, setTipPercent] = useState<number | null>(null); // null = not set
  const [customTipAmount, setCustomTipAmount] = useState<string>('');

  /* Payment method state */
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'cash' | 'gateway' | null>(null);
  const [utrReference, setUtrReference] = useState<string>('');

  /* Digital bill modal state */
  const [isBillOpen, setIsBillOpen] = useState(false);

  /* Submission / feedback state */
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Derived */
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return menuItems.filter((item) => {
      const matchCategory = selectedCategory === 'All' || item.category === selectedCategory;
      const matchSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.description ?? '').toLowerCase().includes(q);
      return matchCategory && matchSearch;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [cart],
  );
  const itemCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  const tipAmountCents = useMemo(() => {
    if (tipPercent === null) return 0;
    if (customTipAmount) {
      const customCents = Math.round(Number(customTipAmount) * 100);
      return Number.isNaN(customCents) || customCents < 0 ? 0 : customCents;
    }
    return Math.round((cartSubtotal * tipPercent) / 100);
  }, [cartSubtotal, tipPercent, customTipAmount]);

  const grandTotalCents = useMemo(() => cartSubtotal + tipAmountCents, [
    cartSubtotal,
    tipAmountCents,
  ]);

  const modalCustomizationGroups = useMemo(
    () => parseCustomizationOptions(modalItem?.customization_options ?? null),
    [modalItem?.customization_options],
  );

  const modalCustomizationDelta = useMemo(() => {
    let sum = 0;
    for (const [groupName, opts] of Object.entries(modalSelections)) {
      const group = modalCustomizationGroups.find((g) => g.group === groupName);
      for (const optName of opts) {
        const opt = group?.options.find((o) => o.name === optName);
        if (opt) sum += opt.priceDelta;
      }
    }
    return sum;
  }, [modalSelections, modalCustomizationGroups]);

  const upiPaymentUrl = useMemo(() => {
    if (!tenantSettings?.upi_id || !tenantSettings.merchant_name) return null;
    const amountRupees = (grandTotalCents / 100).toFixed(2);
    const params = new URLSearchParams({
      pa: tenantSettings.upi_id,
      pn: tenantSettings.merchant_name,
      am: amountRupees,
      cu: 'INR',
      tn: `Table ${tableNumber} Order`,
    });
    return `upi://pay?${params.toString()}`;
  }, [tenantSettings, grandTotalCents, tableNumber]);

  /* Data loading */
  const loadMenu = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const slug = tenantSlug ?? 'acme-bistro';
      const { data: tenantData, error: tenantErr } = await getTenantBySlug(slug);
      if (tenantErr) throw tenantErr;
      if (!tenantData) {
        setError('Tenant not found');
        setLoading(false);
        return;
      }
      setTenant(tenantData);

      const { data: settings, error: settingsErr } = await getTenantSettings(tenantData.id);
      if (settingsErr) throw settingsErr;
      setTenantSettings(settings ?? null);

      const { data: items, error: itemsErr } = await getMenuItems(tenantData.id, true);
      if (itemsErr) throw itemsErr;
      setMenuItems(items ?? []);

      const uniqueCats = Array.from(
        new Set((items ?? []).map((item: { category: string }) => item.category)),
      );
      setCategories(['All', ...(uniqueCats as string[])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load menu');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  /* Effects */
  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  useEffect(() => {
    const t = new URLSearchParams(location.search).get('table');
    if (t) setTableNumber(`Table ${t}`);
  }, [location.search]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /* Toast */
  const showToast = useCallback(
    (message: string, type: 'success' | 'error' = 'success', duration = 3500) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type });
      timerRef.current = setTimeout(() => setToast(null), duration);
    },
    [],
  );

  /* Table selector */
  const toggleTableDropdown = () => setIsTableOpen((prev) => !prev);
  const selectTable = (n: number) => {
    setTableNumber(`Table ${n}`);
    setIsTableOpen(false);
  };

  /* Cart */
  const addQuickToCart = useCallback(
    (item: MenuItem) => {
      const lineId = cartLineId(item.id, []);
      setCart((prev) => {
        const existing = prev.find((line) => line.id === lineId);
        if (existing) {
          return prev.map((line) =>
            line.id === lineId ? { ...line, quantity: line.quantity + 1 } : line,
          );
        }
        return [
          ...prev,
          { id: lineId, menuItemId: item.id, name: item.name, price: item.price, quantity: 1, selections: [], notes: '' },
        ];
      });
      showToast(`Added 1× ${item.name} to cart`, 'success', 2000);
      setIsCartOpen(true);
    },
    [showToast],
  );

  const toggleModalOption = useCallback(
    (group: string, option: string, type: 'single' | 'multi') => {
      setModalSelections((prev) => {
        const current = prev[group] ?? [];
        let next: string[];
        if (type === 'single') {
          next = current.includes(option) ? [] : [option];
        } else {
          next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
        }
        return { ...prev, [group]: next };
      });
    },
    [],
  );

  const openModal = useCallback((item: MenuItem) => {
    setModalItem(item);
    setModalQuantity(1);
    setModalSelections({});
    setModalNotes('');
    setIsCartOpen(false);
  }, []);

  const closeModal = useCallback(() => {
    setModalItem(null);
  }, []);

  const addToCartFromModal = useCallback(() => {
    if (!modalItem) return;
    setSubmitting(true);
    try {
      const selections: SelectedCustomization[] = [];
      let addedPrice = 0;
      for (const [groupName, opts] of Object.entries(modalSelections)) {
        const group = modalCustomizationGroups.find((g) => g.group === groupName);
        for (const optName of opts) {
          const opt = group?.options.find((o) => o.name === optName);
          if (opt) {
            selections.push({ group: groupName, option: optName, priceDelta: opt.priceDelta });
            addedPrice += opt.priceDelta;
          }
        }
      }

      const unitPrice = modalItem.price + addedPrice;
      const lineId = cartLineId(modalItem.id, selections);

      setCart((prev) => {
        const existing = prev.find((line) => line.id === lineId);
        if (existing) {
          return prev.map((line) =>
            line.id === lineId ? { ...line, quantity: line.quantity + modalQuantity } : line,
          );
        }
        return [
          ...prev,
          {
            id: lineId,
            menuItemId: modalItem.id,
            name: modalItem.name,
            price: unitPrice,
            quantity: modalQuantity,
            selections,
            notes: modalNotes,
          },
        ];
      });

      showToast(`Added ${modalQuantity}× ${modalItem.name} to cart`, 'success', 2000);
      setModalItem(null);
      setIsCartOpen(true);
    } catch (err) {
      showToast('Failed to add item to cart', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }, [modalItem, modalQuantity, modalSelections, modalNotes, modalCustomizationGroups, showToast]);

  const updateQuantity = useCallback(
    (lineId: string, delta: number) => {
      setCart((prev) =>
        prev
          .map((line) => {
            if (line.id !== lineId) return line;
            const newQty = line.quantity + delta;
            return newQty > 0 ? { ...line, quantity: newQty } : null;
          })
          .filter((line): line is CartItem => line !== null),
      );
    },
    [],
  );

  const removeFromCart = useCallback((lineId: string) => {
    setCart((prev) => prev.filter((line) => line.id !== lineId));
  }, []);

  /* Tip selection */
  const selectTip = useCallback((percent: number | null) => {
    setTipPercent(percent);
    if (percent === null) setCustomTipAmount('');
  }, []);

  const setCustomTip = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTipPercent(null); // custom amount overrides percentage
    setCustomTipAmount(e.target.value);
  }, []);

  const tipChipLabel = (p: number) => (p === 0 ? 'No Tip' : `${p}%`);
  const isTipSelected = (p: number) => {
    if (tipPercent === null) return false;
    return tipPercent === p;
  };

  /* Waiter call */
  const handleCallWaiter = useCallback(async () => {
    if (!tenant) return;
    setSubmitting(true);
    try {
      const { error: callErr } = await createWaiterCall({
        tenant_id: tenant.id,
        table_number: tableNumber,
        message: 'Customer needs assistance',
      });
      if (callErr) throw callErr;
      showToast("Waiter called — they'll be with you shortly", 'success');
    } catch (err) {
      showToast('Failed to call waiter', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }, [tenant, tableNumber, showToast]);

  /* Order submission */
  const handlePlaceOrder = useCallback(async () => {
    if (!tenant || cart.length === 0) return;
    if (!paymentMethod) {
      showToast('Please select a payment method', 'error');
      return;
    }
    if (paymentMethod === 'upi' && !tenantSettings?.upi_id) {
      showToast('UPI payments are not configured for this restaurant', 'error');
      return;
    }
    if (paymentMethod === 'upi' && !utrReference.trim()) {
      showToast('Please enter your UTR transaction reference', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const orderItems = cart.map((line) => ({
        menu_item_id: line.menuItemId,
        quantity: line.quantity,
        unit_price: line.price,
        notes: line.notes || null,
        customizations: line.selections.length > 0 ? JSON.stringify(line.selections) : null,
      }));

      const { error: orderErr } = await createOrder({
        tenant_id: tenant.id,
        table_number: tableNumber,
        total: grandTotalCents,
        tip_amount: tipAmountCents,
        payment_method: paymentMethod,
        payment_status: paymentMethod === 'upi' ? 'pending' : 'paid',
        utr_reference: paymentMethod === 'upi' ? utrReference.trim() || null : null,
        items: orderItems,
      });
      if (orderErr) throw orderErr;

      setCart([]);
      setIsCartOpen(false);
      setIsBillOpen(false);
      setPaymentMethod(null);
      setUtrReference('');
      setTipPercent(null);
      setCustomTipAmount('');
      showToast(
        paymentMethod === 'upi'
          ? 'Order placed! Awaiting UPI payment verification.'
          : 'Order placed successfully!',
        'success',
      );
    } catch (err) {
      showToast('Failed to place order. Please try again.', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }, [
    tenant,
    tenantSettings,
    cart,
    cartSubtotal,
    tipAmountCents,
    grandTotalCents,
    tableNumber,
    paymentMethod,
    utrReference,
    showToast,
  ]);

  const handleVerifyUpiPayment = useCallback(async () => {
    if (!utrReference.trim()) {
      showToast('Please enter a UTR reference', 'error');
      return;
    }
    setSubmitting(true);
    try {
      // In a real flow, this would verify with the payment gateway.
      // Here we mark the most recent pending order for this tenant/table as paid.
      const { data: orders, error: ordersErr } = await getOrders(tenant!.id, ['pending']);
      if (ordersErr) throw ordersErr;
      const recentOrder = orders?.[orders.length - 1];
      if (!recentOrder) {
        showToast('No pending order found to verify', 'error');
        return;
      }
      const { error: settleErr } = await settlePayment(recentOrder.id, utrReference.trim());
      if (settleErr) throw settleErr;

      setIsBillOpen(false);
      setUtrReference('');
      setSubmitting(false);
      showToast('UPI payment verified and order marked as paid', 'success');
    } catch (err) {
      showToast('Payment verification failed. Please try again.', 'error');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }, [tenant, utrReference, getOrders, settlePayment, showToast]);

  /* Open digital bill (tip + payment) */
  const openBill = useCallback(() => {
    setIsBillOpen(true);
  }, []);

  const closeBill = useCallback(() => {
    setIsBillOpen(false);
    setPaymentMethod(null);
    setUtrReference('');
    setTipPercent(null);
    setCustomTipAmount('');
  }, []);

  /* Empty / error states */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex flex-col items-center justify-center font-sans">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-amber-500" aria-label="Loading" />
        <p className="text-sm">Loading menu…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex flex-col items-center justify-center font-sans p-6 text-center">
        <AlertCircle className="w-8 h-8 mb-3 text-rose-500" aria-label="Error" />
        <h2 className="text-slate-200 font-semibold mb-2">Something went wrong</h2>
        <p className="text-sm text-slate-400 mb-6">{error}</p>
        <button
          onClick={() => {
            setError(null);
            void loadMenu();
          }}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased pb-24">
      {/* Order placement loading overlay */}
      <div
        className={`fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 ${
          submitting ? '' : 'hidden'
        }`}
        role="status"
        aria-live="polite"
        aria-label="Placing order"
      >
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" aria-hidden="true" />
        <span className="text-sm font-medium text-slate-200">Placing order…</span>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
            <Utensils className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-bold text-amber-400 leading-tight">
              {tenant?.name ?? 'Acme Bistro'}
            </h1>
            <div className="flex items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold border ${
                  hasSupabaseConfig
                    ? 'bg-emerald-900/50 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-900/50 text-amber-400 border-amber-500/30'
                }`}
              >
                {hasSupabaseConfig ? 'Live' : 'Demo'}
              </span>
              <span className="text-xs text-slate-500">• {tableNumber}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 justify-end">
          {/* Table number selector */}
          <div className="relative">
            <button
              onClick={toggleTableDropdown}
              aria-expanded={isTableOpen}
              aria-label="Select table"
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 hover:bg-slate-700 transition focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {tableNumber}
              <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
            </button>
            {isTableOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-2 z-30 flex flex-col">
                {[...Array(12)].map((_, i) => {
                  const n = i + 1;
                  return (
                    <button
                      key={n}
                      onClick={() => selectTable(n)}
                      className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-amber-500/10 hover:text-amber-400 transition"
                    >
                      Table {n}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Call Waiter */}
          <button
            onClick={handleCallWaiter}
            disabled={submitting}
            aria-label="Call waiter"
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-200 hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <Bell className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Call Waiter</span>
          </button>

          {/* Cart */}
          <button
            onClick={() => setIsCartOpen(true)}
            aria-label={`Cart (${itemCount} items)`}
            className="relative p-2.5 bg-amber-500 text-slate-950 rounded-full font-bold shadow-lg shadow-amber-500/20 hover:bg-amber-400 transition focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            <ShoppingBag className="w-5 h-5" aria-hidden="true" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-rose-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                {itemCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="px-4">
        <div className="relative max-w-lg mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search menu items…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition"
            aria-label="Search menu items"
          />
        </div>
      </div>

      {/* Category chips */}
      <div className="px-4 py-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              role="tab"
              aria-pressed={selectedCategory === cat}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Menu grid */}
      <main className="px-4 py-4">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-slate-500">No menu items match your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => (
              <article
                key={item.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col group cursor-pointer"
                onClick={() => openModal(item)}
                aria-label={`View ${item.name} details`}
              >
                <div className="relative h-48 bg-slate-800">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-slate-800/50 flex items-center justify-center text-slate-600">
                      <Utensils className="w-10 h-10" aria-hidden="true" />
                    </div>
                  )}
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-semibold bg-slate-900/80 text-slate-300">
                    {item.category}
                  </span>
                  {!item.is_available && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-bold bg-rose-900/90 text-rose-200">
                      Unavailable
                    </span>
                  )}
                </div>
                <div className="p-4 flex flex-col flex-1 justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-lg text-slate-100">{item.name}</h3>
                      <span className="font-extrabold text-amber-400">${formatPrice(item.price)}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.description ?? ''}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addQuickToCart(item);
                    }}
                    className="w-full py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl font-bold transition flex items-center justify-center space-x-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Add to Cart</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Item detail modal */}
      {modalItem && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-6"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-label={modalItem.name}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-800 flex justify-between items-start">
              <div>
                <h2 className="text-lg font-bold text-slate-100">{modalItem.name}</h2>
                <p className="text-xs text-amber-400 font-bold">${formatPrice(modalItem.price)}</p>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                <X className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>

            <div className="p-4">
              {modalItem.image_url && (
                <img
                  src={modalItem.image_url}
                  alt={modalItem.name}
                  className="w-full h-40 object-cover rounded-xl bg-slate-800 mb-3"
                />
              )}
              <p className="text-sm text-slate-300 mb-4">{modalItem.description ?? 'No description available.'}</p>

              {/* Customizations */}
              {modalCustomizationGroups.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-bold text-slate-200 mb-3 border-b border-slate-800 pb-2">Customize</h3>
                  <div className="space-y-3">
                    {modalCustomizationGroups.map((group) => (
                      <div key={group.group}>
                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                          {group.group}
                        </h4>
                        <div className={group.type === 'multi' ? 'grid grid-cols-2 gap-2' : 'space-y-1.5'}>
                          {group.options.map((opt) => {
                            const isSelected = (modalSelections[group.group] ?? []).includes(opt.name);
                            return (
                              <button
                                key={opt.name}
                                onClick={() => toggleModalOption(group.group, opt.name, group.type)}
                                className={`flex items-center gap-2 px-3 py-2 rounded border text-sm transition ${
                                  isSelected
                                    ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-700'
                                }`}
                              >
                                {group.type === 'multi' ? (
                                  <span
                                    className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                                      isSelected ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-transparent border-slate-600 text-slate-400'
                                    }`}
                                  >
                                    {isSelected ? '✓' : ''}
                                  </span>
                                ) : (
                                  <span
                                    className={`w-4 h-4 rounded-full border flex items-center justify-center text-xs ${
                                      isSelected ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-transparent border-slate-600'
                                    }`}
                                  >
                                    {isSelected ? '●' : ''}
                                  </span>
                                )}
                                <span>{opt.name}</span>
                                {opt.priceDelta > 0 && (
                                  <span className="ml-auto text-xs text-amber-400 font-bold">+{formatPrice(opt.priceDelta)}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quantity */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-400 mb-1">Quantity</label>
                <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl p-1">
                  <button
                    onClick={() => setModalQuantity((q) => Math.max(1, q - 1))}
                    className="p-1 hover:bg-slate-700 rounded text-slate-300 focus:outline-none"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <span className="w-6 text-center font-bold text-slate-100">{modalQuantity}</span>
                  <button
                    onClick={() => setModalQuantity((q) => q + 1)}
                    className="p-1 hover:bg-slate-700 rounded text-slate-300 focus:outline-none"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-slate-400 mb-1">Special notes (optional)</label>
                <textarea
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:ring-2 focus:ring-amber-500 outline-none transition"
                  placeholder="e.g. extra sauce"
                  aria-label="Special notes"
                />
              </div>

              {/* Add to cart */}
              <div className="pt-4 border-t border-slate-800">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm text-slate-300">Total</span>
                  <span className="text-sm font-bold text-amber-400">
                    ${formatPrice((modalItem.price + modalCustomizationDelta) * modalQuantity)}
                  </span>
                </div>
                <button
                  onClick={addToCartFromModal}
                  disabled={submitting || !modalItem}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {submitting ? 'Adding…' : `Add ${modalQuantity}× to Cart`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cart drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md">
        <div
          className={`flex flex-col h-full bg-slate-900 border-l border-slate-800 shadow-2xl transition-transform duration-300 ease-in-out ${
            isCartOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="p-4 border-b border-slate-800 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-6 h-6 text-amber-400" aria-hidden="true" />
              <h2 className="text-xl font-black text-slate-100">Your Cart</h2>
            </div>
            <button
              onClick={() => setIsCartOpen(false)}
              className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              aria-label="Close cart"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {cart.length === 0 ? (
              <p className="text-slate-500 text-center py-12">Your cart is empty.</p>
            ) : (
              cart.map((line) => (
                <div key={line.id} className="p-3 bg-slate-800/80 border border-slate-700/50 rounded-xl">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-sm text-slate-100">{line.name}</h4>
                    <span className="text-xs font-bold text-amber-400">${formatPrice(line.price * line.quantity)}</span>
                  </div>
                  {line.selections.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {line.selections.map((sel) => (
                        <span
                          key={`${sel.group}-${sel.option}`}
                          className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-xs text-amber-200"
                        >
                          {sel.group}: {sel.option}{sel.priceDelta > 0 && ` (+${formatPrice(sel.priceDelta)})`}
                        </span>
                      ))}
                    </div>
                  )}
                  {line.notes && (
                    <p className="text-xs text-slate-400 italic mb-2">Note: {line.notes}</p>
                  )}
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg p-1">
                    <button
                      onClick={() => updateQuantity(line.id, -1)}
                      className="p-1 hover:bg-slate-800 text-slate-300 rounded focus:outline-none"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <span className="text-xs font-bold text-slate-100 px-1">{line.quantity}</span>
                    <button
                      onClick={() => updateQuantity(line.id, 1)}
                      className="p-1 hover:bg-slate-800 text-slate-300 rounded focus:outline-none"
                      aria-label="Increase quantity"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => removeFromCart(line.id)}
                      className="p-1 hover:bg-rose-900/50 text-rose-400 rounded focus:outline-none"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div className="p-4 pt-2 border-t border-slate-800 mt-auto">
              <div className="space-y-3 mb-4">
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-sm font-medium">Subtotal</span>
                  <span className="text-sm font-bold text-slate-100">${formatPrice(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-sm font-medium">Tip</span>
                  <span className="text-sm font-bold text-amber-400">${formatPrice(tipAmountCents)}</span>
                </div>
                <div className="flex justify-between items-center text-slate-100 border-t pt-2">
                  <span className="text-sm font-bold">Grand Total</span>
                  <span className="text-sm font-black text-amber-400">${formatPrice(grandTotalCents)}</span>
                </div>
              </div>

              {/* Tipping step */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 mb-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Tip for Serving Pilot</h4>
                <div className="flex gap-2">
                  {[0, 5, 10, 15].map((p) => (
                    <button
                      key={p}
                      onClick={() => selectTip(p)}
                      className={`flex-1 px-2 py-2 rounded border text-xs font-medium transition ${
                        isTipSelected(p)
                          ? 'bg-amber-500 border-amber-500 text-slate-950'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {tipChipLabel(p)}
                    </button>
                  ))}
                  <button
                    onClick={() => selectTip(null)}
                    className={`flex-1 px-2 py-2 rounded border text-xs font-medium transition ${
                      tipPercent === null && !customTipAmount ? 'bg-amber-500 border-amber-500 text-slate-950' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {tipPercent === null && (
                  <div className="mt-2">
                    <input
                      type="text"
                      placeholder="₹ amount"
                      value={customTipAmount}
                      onChange={setCustomTip}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Payment method selection */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 mb-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Payment Method</h4>
                <div className="space-y-2">
                  {(tenantSettings?.cash_enabled ?? true) && (
                    <button
                      onClick={() => setPaymentMethod('cash')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded border text-left transition ${
                        paymentMethod === 'cash'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span className="w-5 h-5 rounded flex items-center justify-center ${
                        paymentMethod === 'cash' ? 'bg-amber-500 text-slate-950' : 'bg-transparent border border-slate-600'
                      }">
                        {paymentMethod === 'cash' ? '✓' : '○'}
                      </span>
                      <span className="text-sm font-medium">Cash / Pay at Counter</span>
                    </button>
                  )}
                  {(tenantSettings?.upi_enabled ?? false) && (
                    <button
                      onClick={() => setPaymentMethod('upi')}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded border text-left transition ${
                        paymentMethod === 'upi'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span className="w-5 h-5 rounded flex items-center justify-center ${
                        paymentMethod === 'upi' ? 'bg-amber-500 text-slate-950' : 'bg-transparent border border-slate-600'
                      }">
                        {paymentMethod === 'upi' ? '✓' : '○'}
                      </span>
                      <span className="text-sm font-medium">UPI Direct</span>
                    </button>
                  )}
                  {(tenantSettings?.gateway_enabled ?? false) && (
                    <button
                      onClick={() => setPaymentMethod('gateway')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded border text-left text-slate-500 bg-slate-900 border-slate-700 transition"
                    >
                      <span className="w-5 h-5 rounded flex items-center justify-center text-slate-600">○</span>
                      <span className="text-sm font-medium text-slate-400">Pay Online (Razorpay / Stripe)</span>
                      <span className="ml-auto text-[10px] text-slate-500">Coming soon</span>
                    </button>
                  )}
                </div>
              </div>

              {/* UPI payment details */}
              {paymentMethod === 'upi' && tenantSettings && (
                <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-3 mb-4">
                  <h4 className="text-xs font-bold text-amber-400 uppercase mb-2">Pay with UPI</h4>
                  <div className="flex flex-col gap-2">
                    {tenantSettings.upi_qr_image_url && (
                      <div className="flex justify-center">
                        <img
                          src={tenantSettings.upi_qr_image_url}
                          alt="UPI QR Code"
                          className="w-24 h-24 rounded-lg bg-slate-900"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">UPI ID</span>
                        <span className="text-sm font-mono text-amber-400">{tenantSettings.upi_id}</span>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(tenantSettings.upi_id!);
                          showToast('UPI ID copied', 'success', 2000);
                        }}
                        className="text-xs text-amber-400 hover:text-amber-300"
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                    {upiPaymentUrl && (
                      <a
                        href={upiPaymentUrl}
                        className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg text-center transition"
                      >
                        Open in UPI App
                      </a>
                    )}
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">UTR Reference</label>
                      <input
                        type="text"
                        value={utrReference}
                        onChange={(e) => setUtrReference(e.target.value)}
                        placeholder="Enter UTR transaction ID"
                        className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                      />
                      {tenantSettings.upi_instruction_notes && (
                        <p className="text-[10px] text-slate-500 mt-1">{tenantSettings.upi_instruction_notes}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {paymentMethod === 'upi' && !tenantSettings?.upi_id && (
                <div className="text-xs text-rose-400 bg-rose-900/20 border border-rose-500/30 rounded-lg p-2 mb-4">
                  UPI payments are not configured for this restaurant.
                </div>
              )}

              {/* Grand total + action */}
              <div className="border-t pt-3">
                <div className="flex justify-between items-center mb-3 text-slate-100">
                  <span className="text-sm font-bold">Amount to Pay</span>
                  <span className="text-lg font-black text-amber-400">${formatPrice(grandTotalCents)}</span>
                </div>
                <button
                  onClick={openBill}
                  disabled={submitting || grandTotalCents === 0 || !paymentMethod}
                  className={`w-full py-3 rounded-xl font-bold transition shadow-lg disabled:opacity-60 disabled:cursor-not-allowed ${
                    paymentMethod && grandTotalCents > 0
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                      : 'bg-slate-800 border border-slate-700 text-slate-500'
                  }`}
                >
                  {submitting ? 'Sending Order…' : `Pay ₹${formatPrice(grandTotalCents)}`}
                </button>
              </div>
            </div>
          )}
        </div>
        {isCartOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setIsCartOpen(false)} aria-hidden="true" />
        )}
      </div>

      {/* Digital Bill / Tip modal */}
      {isBillOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col"
          >
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-100">Digital Bill</h2>
              <button onClick={closeBill} className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800">
                <X className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="text-slate-400 text-sm">Subtotal</span>
                  <span className="text-slate-200 font-mono">${formatPrice(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="text-slate-400 text-sm">Tip for Serving Pilot</span>
                  <span className="text-amber-400 font-mono">+${formatPrice(tipAmountCents)}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-slate-100 font-bold">Total</span>
                  <span className="text-amber-400 font-bold font-mono">${formatPrice(grandTotalCents)}</span>
                </div>
              </div>

              <div className="mt-6 p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Payment</h4>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs font-medium text-slate-300">Method</span>
                    <span className="text-sm font-bold text-slate-100 block mt-1">
                      {paymentMethod === 'upi' ? 'UPI Direct' : paymentMethod === 'cash' ? 'Cash' : 'Online Gateway'}
                    </span>
                  </div>
                  {paymentMethod === 'upi' && tenantSettings && (
                    <div>
                      <span className="text-xs font-medium text-slate-300">UPI ID</span>
                      <span className="text-sm font-mono text-amber-400 block mt-1">{tenantSettings.upi_id}</span>
                    </div>
                  )}
                  {paymentMethod === 'upi' && utrReference && (
                    <div>
                      <span className="text-xs font-medium text-slate-300">UTR Reference</span>
                      <span className="text-sm font-mono text-slate-100 block mt-1">{utrReference}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-3">
                <button
                  onClick={closeBill}
                  className="px-5 py-2.5 rounded-xl text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition"
                >
                  Edit
                </button>
                {paymentMethod === 'upi' ? (
                  <button
                    onClick={handleVerifyUpiPayment}
                    disabled={submitting || !utrReference.trim()}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-60 transition"
                  >
                    {submitting ? 'Verifying…' : 'Verify UTR & Settle'}
                  </button>
                ) : (
                  <button
                    onClick={handlePlaceOrder}
                    disabled={submitting}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-60 transition"
                  >
                    {submitting ? 'Placing Order…' : 'Confirm & Pay'}
                  </button>
                )}
              </div>
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
              <CircleCheck className="w-5 h-5" aria-hidden="true" />
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
