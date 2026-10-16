import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ShoppingBag, Plus, Minus, X, Utensils, Play } from 'lucide-react';

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image_url: string;
  video_url?: string;
  is_available: boolean;
}

interface CartItem extends MenuItem {
  quantity: number;
}

export function MenuPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const [tenant, setTenant] = useState<any>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orderSubmitting, setOrderSubmitting] = useState(false);

  useEffect(() => {
    fetchTenantAndMenu();
  }, [tenantSlug]);

  async function fetchTenantAndMenu() {
    try {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('*')
        .eq('slug', tenantSlug || 'acme-bistro')
        .single();

      if (tenantData) {
        setTenant(tenantData);
        const { data: items } = await supabase
          .from('menu_items')
          .select('*')
          .eq('tenant_id', tenantData.id)
          .eq('is_available', true);

        if (items) {
          setMenuItems(items);
          const uniqueCats = Array.from(new Set(items.map((item) => item.category)));
          setCategories(['All', ...uniqueCats]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.id === id) {
            const newQty = i.quantity + delta;
            return newQty > 0 ? { ...i, quantity: newQty } : null;
          }
          return i;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handlePlaceOrder = async () => {
    if (cart.length === 0 || !tenant) return;
    setOrderSubmitting(true);

    try {
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert({
          tenant_id: tenant.id,
          table_number: 'Table 4',
          status: 'pending',
          order_type: 'dine-in',
          total_amount: totalAmount,
        })
        .select()
        .single();

      if (orderErr) throw orderErr;

      const orderItems = cart.map((item) => ({
        order_id: order.id,
        menu_item_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
      }));

      await supabase.from('order_items').insert(orderItems);

      setCart([]);
      setIsCartOpen(false);
      alert('Order placed successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to place order.');
    } finally {
      setOrderSubmitting(false);
    }
  };

  const filteredItems = selectedCategory === 'All' ? menuItems : menuItems.filter((i) => i.category === selectedCategory);

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-sans">Loading Menu...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
            <Utensils className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-amber-400 leading-tight">{tenant?.name || 'Acme Bistro'}</h1>
            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-medium">Table 4</span>
          </div>
        </div>

        <button
          onClick={() => setIsCartOpen(true)}
          className="relative p-2.5 bg-amber-500 text-slate-950 rounded-full font-bold shadow-lg hover:bg-amber-400 transition"
        >
          <ShoppingBag className="w-5 h-5" />
          {cart.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
              {cart.reduce((a, c) => a + c.quantity, 0)}
            </span>
          )}
        </button>
      </header>

      {/* Category Pills */}
      <div className="px-4 py-4 flex space-x-2 overflow-x-auto no-scrollbar">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition whitespace-nowrap ${
              selectedCategory === cat ? 'bg-amber-500 text-slate-950 shadow-md' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Menu Cards */}
      <main className="px-4 space-y-4 max-w-2xl mx-auto">
        {filteredItems.map((item) => (
          <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col">
            <div className="relative h-48 w-full bg-slate-800">
              <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
              {item.video_url && (
                <button className="absolute bottom-3 right-3 p-2 bg-black/60 backdrop-blur-md text-amber-400 rounded-full hover:bg-black/80">
                  <Play className="w-4 h-4 fill-amber-400" />
                </button>
              )}
            </div>
            <div className="p-4 flex flex-col justify-between flex-1">
              <div>
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-lg text-slate-100">{item.name}</h3>
                  <span className="font-extrabold text-amber-400">${item.price.toFixed(2)}</span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-2 mb-4">{item.description}</p>
              </div>
              <button
                onClick={() => addToCart(item)}
                className="w-full py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl font-bold transition flex items-center justify-center space-x-1 text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add to Cart</span>
              </button>
            </div>
          </div>
        ))}
      </main>

      {/* Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-4 border-b border-slate-800 mb-4">
              <div className="flex items-center space-x-2">
                <ShoppingBag className="w-6 h-6 text-amber-400" />
                <h2 className="text-xl font-black text-slate-100">Your Cart</h2>
              </div>
              <button onClick={() => setIsCartOpen(false)} className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {cart.length === 0 ? (
                <p className="text-slate-500 text-center py-12">Your cart is empty.</p>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="p-3 bg-slate-800/80 border border-slate-700/50 rounded-xl flex items-center justify-between">
                    <div>
                      <p className="font-bold text-sm text-slate-100">{item.name}</p>
                      <p className="text-xs text-amber-400">${(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                    <div className="flex items-center space-x-2 bg-slate-900 border border-slate-700 rounded-lg p-1">
                      <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-slate-800 text-slate-300 rounded">
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-bold text-slate-100 px-1">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-slate-800 text-slate-300 rounded">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <div className="pt-4 border-t border-slate-800 mt-auto">
                <div className="flex justify-between items-center mb-4 text-slate-300">
                  <span className="font-semibold text-sm">Total</span>
                  <span className="text-xl font-bold text-amber-400">${totalAmount.toFixed(2)}</span>
                </div>
                <button
                  onClick={handlePlaceOrder}
                  disabled={orderSubmitting}
                  className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-amber-500/10 disabled:opacity-50"
                >
                  {orderSubmitting ? 'Sending Order...' : 'Place Order Now'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
