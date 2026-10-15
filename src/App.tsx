import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MenuPage } from './pages/MenuPage';
import { KitchenPage } from './pages/KitchenPage';
import { AdminPage } from './pages/AdminPage';
import { PilotPage } from './pages/PilotPage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/:tenantSlug/menu" element={<MenuPage />} />
        <Route path="/:tenantSlug/kitchen" element={<KitchenPage />} />
        <Route path="/:tenantSlug/admin" element={<AdminPage />} />
        <Route path="/:tenantSlug/pilot" element={<PilotPage />} />
        
        {/* Safe default redirect */}
        <Route path="*" element={<Navigate to="/acme-bistro/pilot" replace />} />
      </Routes>
    </Router>
  );
}
