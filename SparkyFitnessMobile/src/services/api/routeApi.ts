import type {
  CreateRouteBody,
  ImportGpxRouteBody,
  Route,
  RouteFromActivityBody,
  RouteSummary,
  UpdateRouteBody,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

const SERVICE = 'Routes API';

/** The person's saved routes, newest first, without their points. */
export const fetchRoutes = (): Promise<{ routes: RouteSummary[] }> =>
  apiFetch<{ routes: RouteSummary[] }>({
    endpoint: '/api/v2/routes',
    serviceName: SERVICE,
    operation: 'fetch routes',
  });

export const fetchRoute = (id: string): Promise<{ route: Route }> =>
  apiFetch<{ route: Route }>({
    endpoint: `/api/v2/routes/${id}`,
    serviceName: SERVICE,
    operation: 'fetch route',
  });

export const createRoute = (
  body: Omit<CreateRouteBody, 'activity'> & Partial<CreateRouteBody>
): Promise<{ route: Route }> =>
  apiFetch<{ route: Route }>({
    endpoint: '/api/v2/routes',
    serviceName: SERVICE,
    operation: 'create route',
    method: 'POST',
    body,
  });

export const importGpxRoute = (
  body: Omit<ImportGpxRouteBody, 'activity'> & Partial<ImportGpxRouteBody>
): Promise<{ route: Route }> =>
  apiFetch<{ route: Route }>({
    endpoint: '/api/v2/routes/import-gpx',
    serviceName: SERVICE,
    operation: 'import GPX route',
    method: 'POST',
    body,
  });

export const createRouteFromActivity = (
  exerciseEntryId: string,
  body: RouteFromActivityBody = {}
): Promise<{ route: Route }> =>
  apiFetch<{ route: Route }>({
    endpoint: `/api/v2/routes/from-activity/${exerciseEntryId}`,
    serviceName: SERVICE,
    operation: 'save activity as route',
    method: 'POST',
    body,
  });

export const updateRoute = (
  id: string,
  body: UpdateRouteBody
): Promise<{ route: Route }> =>
  apiFetch<{ route: Route }>({
    endpoint: `/api/v2/routes/${id}`,
    serviceName: SERVICE,
    operation: 'update route',
    method: 'PATCH',
    body,
  });

export const deleteRoute = (id: string): Promise<void> =>
  apiFetch<void>({
    endpoint: `/api/v2/routes/${id}`,
    serviceName: SERVICE,
    operation: 'delete route',
    method: 'DELETE',
  });
