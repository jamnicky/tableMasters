# TableMasters Customer Guide & Product Documentation

**TableMasters** — Multi-Tenant Restaurant Ordering Platform  
Version 1.0 • For Restaurant Owners & Operations Staff  
Last Updated: October 16, 2026

---

## Executive Overview & System Architecture

TableMasters is a modern, multi-tenant restaurant ordering platform that enables restaurants to offer self-service digital menus, real-time kitchen coordination, and centralized management — all through a single web application. Each restaurant (tenant) operates in its own isolated environment with a unique subdomain-style URL (e.g., `your-restaurant.tablemasters.com/menu`).

### Core Modules

| Module | URL Path | Primary User | Purpose |
|--------|----------|--------------|---------|
| Customer Self-Ordering Menu | `/:tenantSlug/menu?table=X` | Diners | Browse menu, customize items, place orders, call waiter |
| Kitchen Display System (KDS) | `/:tenantSlug/kitchen` | Kitchen staff | View incoming orders, track preparation status, mark items ready |
| Admin Dashboard | `/:tenantSlug/admin` | Managers/Owners | Menu management, order monitoring, table & QR code generation |

### Technical Architecture

TableMasters is built on a modern, type-safe stack:

- **Frontend:** React 18 + TypeScript + Vite, styled with Tailwind CSS
- **Icons:** Lucide React
- **Backend:** Supabase (PostgreSQL + Realtime sockets) for data and live updates
- **Routing:** React Router DOM with tenant-slug parameterization
- **Deployment:** Multi-stage Docker build (Node 18 build → Nginx static serving on port 80)
- **SPA Routing:** Nginx configured with `try_files $uri $uri/ /index.html` for HTML5 History API support

The platform uses **Supabase Realtime** to push live order updates to kitchen displays and admin dashboards, ensuring kitchen staff see new orders instantly without refreshing the page.

---

## Customer Self-Ordering Experience

Diners access the self-ordering menu via a unique table-specific URL (e.g., `/acme-bistro/menu?table=4`). The interface is mobile-responsive, dark-themed, and optimized for touch interaction.

### Features

- **Category Filtering:** Browse items by Appetizers, Mains, Drinks, and Desserts using category chips
- **Search:** Real-time text search across item names and descriptions
- **Item Detail Modal:** View full item descriptions, customization options (e.g., doneness, extras), quantity selector, and special notes
- **Cart Drawer:** Slide-out cart with quantity controls, line-item customization tags, and grand total
- **Table Selection:** Table number is pre-filled from the URL (`?table=X`) and can be changed via dropdown
- **Call Waiter:** One-tap button that sends an immediate alert to the kitchen and admin dashboard
- **Order Submission:** Orders are placed with `pending` status and appear instantly in the KDS

### Screenshots

#### Customer Menu (Table 4)

![Customer Menu — Table 4 view with category filtering and item cards](./docs/screenshots/01-customer-menu.png)

#### Cart Drawer — Open

![Cart Drawer — Slide-out cart with item quantities and Place Order button](./docs/screenshots/02-cart-drawer.png)

---

## Kitchen Display System (KDS) Operations

The Kitchen Display System (`/:tenantSlug/kitchen`) is a real-time, high-contrast dashboard designed for kitchen staff working in fast-paced environments. Orders flow through three status columns:

| Column | Status | Meaning |
|--------|--------|---------|
| **Incoming** | `pending` | New order just placed, awaiting kitchen acknowledgment |
| **Cooking** | `preparing` | Kitchen has started preparing the order |
| **Ready** | `ready` | Order is complete and ready for table service |

### Operational Workflow

1. **New order arrives** — A visual banner alert ("New Order Received!") and audio beep notify kitchen staff
2. **Start cooking** — Click "Start Cooking" to move the order to the Cooking column
3. **Mark ready** — Click "Mark as Ready" when the order is complete
4. **Serve complete** — Click "Complete & Serve" to remove the order from the board

### Waiter Call Alerts

When a diner taps "Call Waiter" from the menu, a separate alert banner appears in the KDS with the table number and message. Kitchen or floor staff can acknowledge and resolve the call.

### Screenshot

![Kitchen Display System — Three-column Kanban board with real-time order tracking](./docs/screenshots/03-kitchen-display.png)

---

## Restaurant Management & Admin Dashboard

The Admin Dashboard (`/:tenantSlug/admin`) is the command center for restaurant owners and managers. It contains three management tabs accessible via top navigation.

### Tab 1: Menu Management

Add, edit, and delete menu items with full control over name, description, price, category, image URL, and availability. Changes propagate instantly to the customer menu.

### Tab 2: Live Monitor (Default)

Real-time overview of restaurant operations:

- **Metrics Cards:** Total revenue, active orders, pending waiter calls, tables served
- **Table Status Grid:** All tables with current status (available, occupied, pending, ready, served)
- **Recent Orders Table:** Chronological list of orders with status badges and totals
- **Sales Overview:** Revenue breakdown by order status

### Tab 3: Tables & QR Generator

Generate table-specific QR links for each table (1–12). Each QR link points to `/:tenantSlug/menu?table=N`, allowing diners to scan and access their table's menu directly. Links can be copied to clipboard or downloaded as text files for external QR code generation.

### Screenshots

#### Admin Dashboard — Live Monitor Tab

![Admin Dashboard — Live Monitor with metrics, table status, and recent orders](./docs/screenshots/04-admin-dashboard.png)

#### Admin Dashboard — Menu Management Tab

![Admin Dashboard — Menu Management with add/edit/delete item controls](./docs/screenshots/05-menu-management.png)

---

## Table QR Code Setup & Distribution

QR codes bridge the physical dining space to the digital menu. Each table receives a unique QR code that directs diners to their table-specific ordering page.

### Setup Steps

1. **Open Admin Dashboard** — Navigate to `/:tenantSlug/admin`
2. **Select Tables & QR Tab** — View all 12 table cards with QR links
3. **Copy or Download Links** — Use the "Copy link" button or download the link text file for each table
4. **Generate QR Codes** — Use any external QR code generator with the copied URLs
5. **Print & Display** — Print QR codes and place them on each table

### QR Link Format

```
https://your-domain.com/:tenantSlug/menu?table=N
```

Example: `https://your-domain.com/acme-bistro/menu?table=4`

### Distribution Best Practices

- Place one QR code per table, clearly visible and within easy reach
- Include brief instructions: "Scan to view menu & order"
- Reprint if table numbers or the domain change
- Test all QR codes before opening to diners

### Screenshot

![Tables & QR Generator — 12 table cards with copyable menu links](./docs/screenshots/06-qr-generator.png)

---

## Getting Started Checklist

- [ ] Obtain your Supabase URL and Anon Key from the Supabase Dashboard
- [ ] Copy `.env.example` to `.env` and fill in your Supabase credentials
- [ ] Install dependencies: `npm install`
- [ ] Run locally: `npm run dev`
- [ ] Build for production: `npm run build`
- [ ] Configure your domain and point it to the deployed Nginx container
- [ ] Generate and print table QR codes from the Admin Dashboard
- [ ] Train staff on KDS operations and waiter call handling

---

## Support

For technical issues or feature requests, contact your TableMasters implementation partner or refer to the Supabase documentation for database schema and Realtime configuration details.

---

*© 2026 TableMasters. All rights reserved.*
