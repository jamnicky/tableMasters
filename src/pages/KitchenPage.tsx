import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getTenantBySlug,
  getOrders,
  getMenuItems,
  updateOrderStatus,
  getWaiterCalls,
  resolveWaiterCall,
  subscribeToOrders,
  subscribeToWaiterCalls,
  hasSupabaseConfig,
} from '@/lib/supabase';
import type { MenuItem, Order, OrderItem, Tenant, WaiterCall } from '@/types/database';
import {
  AlertCircle,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Flame,
  UtensilsCrossed,
  X,
} from 'lucide-react';

type BoardStatus = 'pending' | 'preparing' | 'ready';

type OrderWithItems = Order & {
  order_items: OrderItem[];
};

const ALERT_DISMISS_MS = 6000;

const BOARD_COLUMNS: Array<{ id: BoardStatus; title: string }> = [
  { id: 'pending', title: 'Incoming' },
  { id: 'preparing', title: 'Cooking' },
  { id: 'ready', title: 'Ready' },
];

const BOARD_STATUSES: Order['status'][] = ['pending', 'preparing', 'ready'];

/** How long ago an order/call was placed, e.g. "Just now", "5m ago". */
function getTimeElapsed(createdAt: string): string {
  const minutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  return `${minutes}m ago`;
}

/** Render optional customizations (stored as a JSON string or plain text). */
function renderCustomizations(customizations: string | null): React.ReactNode {
  if (!customizations) return null;
  try {
    const parsed = JSON.parse(customizations);
    const text = Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
    return <span className="text-xs text-slate-500">Customizations: {text}</span>;
  } catch {
    return <span className="text-xs text-slate-500">Customizations: {customizations}</span>;
  }
}

function statusBadge(status: Order['status']) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-amber-900/30 text-amber-400 border-amber-500/40">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Pending
        </span>
      );
    case 'preparing':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-blue-900/30 text-blue-400 border-blue-500/40">
          <Flame className="w-3.5 h-3.5 shrink-0" /> Preparing
        </span>
      );
    case 'ready':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border bg-emerald-900/30 text-emerald-400 border-emerald-500/40">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Ready
        </span>
      );
    default:
      return null;
  }
}

type StatusAction = {
  next: Order['status'];
  label: string;
  classes: string;
  icon: React.ReactNode;
} | null;

function statusAction(status: Order['status']): StatusAction {
  switch (status) {
    case 'pending':
      return {
        next: 'preparing',
        label: 'Start Cooking',
        classes: 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-lg shadow-amber-500/20',
        icon: <Flame className="w-4 h-4 shrink-0" />,
      };
    case 'preparing':
      return {
        next: 'ready',
        label: 'Mark Ready',
        classes: 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/20',
        icon: <CheckCircle2 className="w-4 h-4 shrink-0" />,
      };
    case 'ready':
      return {
        next: 'served',
        label: 'Serve Complete',
        classes: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-500/20',
        icon: <Check className="w-4 h-4 shrink-0" />,
      };
    default:
      return null;
  }
}

interface OrderCardProps {
  order: OrderWithItems;
  getItemName: (menuItemId: string) => string;
  onUpdateStatus: (orderId: string, status: Order['status']) => Promise<void>;
  isUpdating: boolean;
}

function OrderCard({ order, getItemName, onUpdateStatus, isUpdating }: OrderCardProps) {
  const [error, setError] = useState<string | null>(null);
  const action = statusAction(order.status);
  const timeElapsed = getTimeElapsed(order.created_at);
  const items = order.order_items ?? [];

  const handleStatusChange = async () => {
    if (!action) return;
    setError(null);
    try {
      await onUpdateStatus(order.id, action.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update order status');
      setTimeout(() => setError(null), 5000);
    }
  };

  if (!action) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col h-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Table</span>
          <span className="text-4xl font-black text-slate-100 tracking-tight">
            {order.table_number}
          </span>
          <span
            className="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-400 text-xs font-semibold rounded"
          >
            {String(order.order_type)
              .charAt(0)
              .toUpperCase() + String(order.order_type).slice(1)}
          </span>
        </div>
        {statusBadge(order.status)}
      </div>

      <div className="flex items-center gap-2 text-slate-500 text-xs mb-3">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>Placed {timeElapsed}</span>
      </div>

      <div className="border-t border-slate-800/60 pt-4 flex-1 divide-y divide-slate-800/40">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">No items</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="py-2 flex justify-between items-baseline gap-2 text-sm">
              <div className="text-slate-200 font-medium truncate">
                {getItemName(item.menu_item_id)}
              </div>
              <span className="font-bold text-slate-400 shrink-0">
                x {item.quantity}
              </span>
            </div>
          ))
        )}
        {items
          .filter((item) => item.customizations)
          .flatMap((item, index) => [
            <div key={`custom-${index}`} className="py-[1px]">
              {renderCustomizations(item.customizations)}
            </div>,
          ])}
      </div>

      {error && <p className="text-xs text-rose-400 mb-3">{error}</p>}

      <button
        onClick={handleStatusChange}
        disabled={isUpdating}
        className={`mt-4 w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition shadow-sm ${action.classes} disabled:opacity-50 disabled:pointer-events-none`}
      >
        {action.icon}
        <span>{action.label}</span>
      </button>
    </div>
  );
}

interface ColumnProps {
  title: string;
  orders: OrderWithItems[];
  getItemName: (menuItemId: string) => string;
  onUpdateStatus: (orderId: string, status: Order['status']) => Promise<void>;
  updatingOrderIds: Set<string>;
}

function Column({
  title,
  orders: columnOrders,
  getItemName,
  onUpdateStatus,
  updatingOrderIds,
}: ColumnProps) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col h-full min-h-[52vh]">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800/50">
        <h2 className="font-bold text-slate-200 text-sm uppercase tracking-wider">
          {title}
        </h2>
        <span className="bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-xs font-semibold">
          {columnOrders.length}
        </span>
      </div>
      <div className="space-y-3 flex-1">
        {columnOrders.length === 0 ? (
          <p className="text-center text-slate-500 text-xs mt-12">No orders</p>
        ) : (
          columnOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              getItemName={getItemName}
              onUpdateStatus={onUpdateStatus}
              isUpdating={updatingOrderIds.has(order.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface WaiterCallRowProps {
  call: WaiterCall;
  timeElapsed: string;
  acknowledged: boolean;
  isResolving: boolean;
  onAcknowledge: (callId: string) => void;
  onResolve: (callId: string) => Promise<void>;
}

function WaiterCallRow({ call, timeElapsed, acknowledged, isResolving, onAcknowledge, onResolve }: WaiterCallRowProps) {
  const handleResolve = async () => {
    try {
      await onResolve(call.id);
    } catch {
      // Page-level handler sets the error banner.
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
      <div className="flex justify-between items-start mb-1">
        <span className="text-lg font-bold text-slate-100">Table {call.table_number}</span>
        <span className="bg-blue-900/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded text-xs font-bold">
          Pending
        </span>
      </div>
      {call.message ? (
        <p className="text-slate-300 text-sm mb-2.5">{call.message}</p>
      ) : (
        <p className="text-xs text-slate-500 mb-2.5">No message provided</p>
      )}
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>Requested {timeElapsed}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onAcknowledge(call.id)}
          disabled={acknowledged}
          className={`px-3 py-2 rounded-lg text-xs font-bold transition disabled:opacity-50 disabled:pointer-events-none ${
            acknowledged ? 'bg-slate-700 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-500'
          }`}
        >
          {acknowledged ? 'Acknowledged' : 'Acknowledge'}
        </button>
        <button
          onClick={handleResolve}
          disabled={isResolving}
          className={`px-3 py-2 rounded-lg text-xs font-bold transition disabled:opacity-50 disabled:pointer-events-none ${
            isResolving ? 'bg-slate-700 text-slate-400' : 'bg-emerald-600 text-white hover:bg-emerald-500'
          }`}
        >
          {isResolving ? 'Resolving…' : 'Resolve'}
        </button>
      </div>
    </div>
  );
}

export function KitchenPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [menuById, setMenuById] = useState<Map<string, MenuItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingOrderIds, setUpdatingOrderIds] = useState<Set<string>>(new Set());
  const [resolvingCallIds, setResolvingCallIds] = useState<Set<string>>(new Set());
  const [acknowledgedCallIds, setAcknowledgedCallIds] = useState<Set<string>>(new Set());
  const [showOrderAlert, setShowOrderAlert] = useState(false);
  const [showWaiterAlert, setShowWaiterAlert] = useState(false);

  const prevPendingOrderIds = useRef<string[]>([]);
  const prevWaiterCallIds = useRef<string[]>([]);
  const ordersInitialized = useRef(false);
  const waiterCallsInitialized = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const orderAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiterAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Generate a short alert beep with the Web Audio API (no external audio files). */
  const playBeep = useCallback(async (kind: 'order' | 'waiter') => {
    try {
      const AudioContextCtor =
        window.AudioContext ??
        ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
          undefined);
      if (!AudioContextCtor) return;
      let ctx = audioCtxRef.current;
      if (!ctx) {
        ctx = new AudioContextCtor();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      if (kind === 'order') {
        osc.frequency.setValueAtTime(960, now);
        osc.frequency.exponentialRampToValueAtTime(1500, now + 0.12);
      } else {
        osc.frequency.setValueAtTime(640, now);
        osc.frequency.exponentialRampToValueAtTime(990, now + 0.15);
      }
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.34);
    } catch {
      // Audio is optional; fail silently if blocked or unavailable.
    }
  }, []);

  const startAlertTimer = useCallback(
    (ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, dismiss: () => void) => {
      if (ref.current) clearTimeout(ref.current);
      ref.current = setTimeout(dismiss, ALERT_DISMISS_MS);
    },
    [],
  );

  const triggerOrderAlert = useCallback(() => {
    setShowOrderAlert(true);
    void playBeep('order');
    startAlertTimer(orderAlertTimerRef, () => setShowOrderAlert(false));
  }, [playBeep, startAlertTimer]);

  const triggerWaiterAlert = useCallback(() => {
    setShowWaiterAlert(true);
    void playBeep('waiter');
    startAlertTimer(waiterAlertTimerRef, () => setShowWaiterAlert(false));
  }, [playBeep, startAlertTimer]);

  const dismissOrderAlert = useCallback(() => {
    if (orderAlertTimerRef.current) clearTimeout(orderAlertTimerRef.current);
    orderAlertTimerRef.current = null;
    setShowOrderAlert(false);
  }, []);

  const dismissWaiterAlert = useCallback(() => {
    if (waiterAlertTimerRef.current) clearTimeout(waiterAlertTimerRef.current);
    waiterAlertTimerRef.current = null;
    setShowWaiterAlert(false);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!tenantSlug) {
      setError('No tenant in URL');
      setLoading(false);
      return;
    }
    try {
      const { data: tenantData, error: tenantError } = await getTenantBySlug(tenantSlug);
      if (tenantError) throw tenantError;
      if (!tenantData) {
        setError(`Tenant "${tenantSlug}" not found`);
        setLoading(false);
        return;
      }
      setTenant(tenantData);

      const [
        { data: ordersData, error: ordersError },
        { data: callsData, error: callsError },
        { data: menuData, error: menuError },
      ] = await Promise.all([
        getOrders(tenantData.id, BOARD_STATUSES),
        getWaiterCalls(tenantData.id),
        getMenuItems(tenantData.id),
      ]);

      if (ordersError) throw ordersError;
      if (callsError) throw callsError;
      if (menuError) throw menuError;

      const nextOrders = (ordersData ?? []) as unknown as OrderWithItems[];
      setOrders(nextOrders);
      setWaiterCalls((callsData ?? []).filter((c) => c.status === 'pending'));

      if (menuData) {
        const map = new Map<string, MenuItem>();
        menuData.forEach((item) => map.set(item.id, item));
        setMenuById(map);
      }

      prevPendingOrderIds.current = nextOrders.filter((o) => o.status === 'pending').map((o) => o.id);
      prevWaiterCallIds.current = (callsData ?? []).map((c) => c.id);
      ordersInitialized.current = true;
      waiterCallsInitialized.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load kitchen data');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  const getItemName = useCallback((menuItemId: string) => menuById.get(menuItemId)?.name ?? `Item ${menuItemId}`, [menuById]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOrdersChange = useCallback(async () => {
    if (!tenant?.id) return;
    const { data, error } = await getOrders(tenant.id, BOARD_STATUSES);
    if (error) {
      setError(String(error));
      return;
    }
    const next = (data ?? []) as OrderWithItems[];
    setOrders(next);
    if (ordersInitialized.current) {
      const pendingIds = next.filter((o) => o.status === 'pending').map((o) => o.id);
      const newlyAdded = pendingIds.filter((id) => !prevPendingOrderIds.current.includes(id));
      if (newlyAdded.length > 0) {
        triggerOrderAlert();
      }
    }
    prevPendingOrderIds.current = next.filter((o) => o.status === 'pending').map((o) => o.id);
  }, [tenant?.id, triggerOrderAlert]);

  const handleWaiterCallsChange = useCallback(async () => {
    if (!tenant?.id) return;
    const { data, error } = await getWaiterCalls(tenant.id);
    if (error) {
      setError(String(error));
      return;
    }
    const next = (data ?? []) as WaiterCall[];
    setWaiterCalls(next.filter((c) => c.status === 'pending'));
    if (waiterCallsInitialized.current) {
      const newlyAdded = next.filter((c) => !prevWaiterCallIds.current.includes(c.id));
      if (newlyAdded.length > 0) {
        triggerWaiterAlert();
      }
    }
    prevWaiterCallIds.current = next.map((c) => c.id);
  }, [tenant?.id, triggerWaiterAlert]);

  useEffect(() => {
    if (!tenant?.id) return;
    const ordersSubscription = subscribeToOrders(tenant.id, handleOrdersChange);
    const waiterCallsSubscription = subscribeToWaiterCalls(tenant.id, handleWaiterCallsChange);
    return () => {
      ordersSubscription.unsubscribe();
      waiterCallsSubscription.unsubscribe();
    };
  }, [tenant?.id, handleOrdersChange, handleWaiterCallsChange]);

  const refreshWaiterCalls = useCallback(async () => {
    if (!tenant?.id) return;
    const { data, error } = await getWaiterCalls(tenant.id);
    if (error) {
      setError(String(error));
      return;
    }
    setWaiterCalls((data ?? []).filter((c) => c.status === 'pending'));
  }, [tenant?.id]);

  const handleUpdateOrderStatus = useCallback(async (orderId: string, status: Order['status']) => {
    setUpdatingOrderIds((prev) => new Set(prev).add(orderId));
    try {
      await updateOrderStatus(orderId, status);
    } finally {
      setUpdatingOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  }, []);

  const handleAcknowledgeWaiterCall = (callId: string) => {
    setAcknowledgedCallIds((prev) => new Set(prev).add(callId));
  };

  const handleResolveWaiterCall = useCallback(async (callId: string) => {
    setResolvingCallIds((prev) => new Set(prev).add(callId));
    try {
      await resolveWaiterCall(callId);
      await refreshWaiterCalls();
    } finally {
      setResolvingCallIds((prev) => {
        const next = new Set(prev);
        next.delete(callId);
        return next;
      });
    }
  }, [refreshWaiterCalls]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-2">
          <UtensilsCrossed className="w-8 h-8 text-amber-500 animate-pulse" />
          <p className="text-sm">Loading kitchen display…</p>
        </div>
      </div>
    );
  }

  if (!tenant || error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
        <div className="max-w-md mx-auto rounded-xl border border-rose-500/30 bg-rose-900/20 p-6 text-rose-300 shadow-2xl">
          <AlertCircle className="w-6 h-6 mb-2" />
          <h2 className="text-lg font-bold text-slate-100 mb-1">Kitchen Display Unavailable</h2>
          <p className="text-sm mb-4">{error || `Tenant "${tenantSlug}" not found`}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-2 md:p-6">
      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-900/20 p-3 text-sm text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto p-1 hover:bg-rose-500/10 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showOrderAlert && (
        <div className="mb-4 animate-bounce rounded-xl border border-amber-500 bg-amber-900/20 text-amber-300 px-4 py-3 flex items-center gap-3 shadow-lg shadow-amber-900/20" role="alert">
          <BellRing className="w-5 h-5 shrink-0" />
          <div>
            <h3 className="font-bold text-sm text-slate-100">New Order Received!</h3>
            <p className="text-xs text-amber-200">A new pending order has arrived on the board.</p>
          </div>
          <button onClick={dismissOrderAlert} className="ml-auto p-1.5 text-amber-500 hover:text-amber-300 rounded hover:bg-amber-900/30">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showWaiterAlert && (
        <div className="mb-4 animate-bounce rounded-xl border border-blue-500 bg-blue-900/20 text-blue-300 px-4 py-3 flex items-center gap-3 shadow-lg shadow-blue-900/20" role="alert">
          <Bell className="w-5 h-5 shrink-0" />
          <div>
            <h3 className="font-bold text-sm text-slate-100">New Waiter Call</h3>
            <p className="text-xs text-blue-200">A table needs attention.</p>
          </div>
          <button onClick={dismissWaiterAlert} className="ml-auto p-1.5 text-blue-500 hover:text-blue-300 rounded hover:bg-blue-900/30">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <UtensilsCrossed className="w-6 h-6" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
              {tenant.name}
              <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded font-normal">
                {hasSupabaseConfig ? 'Live' : 'Mock mode'}
              </span>
            </h1>
            <p className="text-xs text-slate-400">Kitchen Display System &bull; Real-time orders board</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-xs text-slate-500">Active orders</span>
          <span className="text-2xl font-black text-amber-400">{orders.length}</span>
        </div>
      </header>

      <main className="grid gap-6 md:grid-cols-12 lg:grid-cols-14">
        <section className="md:col-span-9 lg:col-span-10 flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-5 h-5 text-slate-400 shrink-0" />
            <h2 className="font-bold text-slate-200 uppercase tracking-wider text-sm">Order Board</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
            {BOARD_COLUMNS.map((column) => {
              const columnOrders = orders.filter((o) => o.status === column.id);
              return (
                <Column
                  key={column.id}
                  title={column.title}
                  orders={columnOrders}
                  getItemName={getItemName}
                  onUpdateStatus={handleUpdateOrderStatus}
                  updatingOrderIds={updatingOrderIds}
                />
              );
            })}
          </div>
        </section>

        <section className="md:col-span-3 lg:col-span-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col h-full">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-400 shrink-0" />
              <h2 className="font-bold text-slate-200 text-sm uppercase tracking-wider">Waiter Calls</h2>
            </div>
            <span className="bg-blue-900/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full text-xs font-bold">
              {waiterCalls.length}
            </span>
          </div>
          <div className="space-y-2 flex-1 overflow-y-auto pr-1">
            {waiterCalls.length === 0 ? (
              <p className="text-center text-slate-500 text-xs mt-10">No pending waiter calls</p>
            ) : (
              waiterCalls.map((call) => (
                <WaiterCallRow
                  key={call.id}
                  call={call}
                  timeElapsed={getTimeElapsed(call.created_at)}
                  acknowledged={acknowledgedCallIds.has(call.id)}
                  isResolving={resolvingCallIds.has(call.id)}
                  onAcknowledge={handleAcknowledgeWaiterCall}
                  onResolve={handleResolveWaiterCall}
                />
              ))
            )}
          </div>
        </section>
      </main>

      <div className="mt-6 text-xs text-slate-500 text-center">
        Columns: Incoming (pending) &rarr; Cooking (preparing) &rarr; Ready (ready). Served and cancelled orders are removed from the board.
      </div>
    </div>
  );
}
