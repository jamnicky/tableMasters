import { useParams } from 'react-router-dom';

/**
 * Hook to resolve the current tenant slug from the URL, e.g.
 * /:tenantSlug/menu -> "acme-bistro".
 */
export function useTenant() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return { tenantSlug };
}
