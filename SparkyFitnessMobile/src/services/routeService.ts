import { useQuery } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import {
  ROUTE_MAX_GPX_CHARS,
  serializeGpx,
  type CreateRouteBody,
  type Route,
  type RouteSummary,
  type UpdateRouteBody,
} from '@workspace/shared';
import { queryClient } from '../hooks/queryClient';
import { routeQueryKey, routesQueryKey } from '../hooks/queryKeys';
import { shareGpxFile } from './gpxExport';
import {
  createRoute,
  createRouteFromActivity,
  deleteRoute,
  fetchRoute,
  fetchRoutes,
  importGpxRoute,
  updateRoute,
} from './api/routeApi';

/** The person's saved routes, newest first, and whether they have loaded. */
export function useRoutes(): {
  routes: RouteSummary[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
} {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: routesQueryKey,
    queryFn: async () => (await fetchRoutes()).routes,
    staleTime: 0,
  });
  return { routes: data ?? [], isLoading, isError, refetch };
}

/** One saved route with its points and cues. */
export function useRoute(id: string): {
  route: Route | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
} {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: routeQueryKey(id),
    queryFn: async () => (await fetchRoute(id)).route,
  });
  return { route: data, isLoading, isError, refetch };
}

const refreshRoutes = () =>
  queryClient.invalidateQueries({ queryKey: routesQueryKey });

export async function saveDrawnRoute(
  input: Omit<CreateRouteBody, 'activity'> & Partial<CreateRouteBody>
): Promise<Route> {
  const { route } = await createRoute(input);
  await refreshRoutes();
  return route;
}

/**
 * Saves a recorded activity's GPS track as a route. The route takes the
 * activity's name; the server cuts it to fit.
 */
export async function saveActivityAsRoute(
  exerciseEntryId: string
): Promise<Route> {
  const { route } = await createRouteFromActivity(exerciseEntryId);
  await refreshRoutes();
  return route;
}

export async function renameRoute(
  id: string,
  patch: UpdateRouteBody
): Promise<Route> {
  const { route } = await updateRoute(id, patch);
  await refreshRoutes();
  return route;
}

export async function removeRoute(id: string): Promise<void> {
  await deleteRoute(id);
  queryClient.setQueryData<RouteSummary[]>(routesQueryKey, (list) =>
    list?.filter((route) => route.id !== id)
  );
  // Only the list is refetched: the deleted route's own screen is still
  // mounted until the caller leaves it, and fetching that route is a 404.
  await queryClient.invalidateQueries({
    queryKey: routesQueryKey,
    exact: true,
  });
}

/** The chosen file is too big to be a route; the server would refuse it too. */
export class GpxFileTooLargeError extends Error {}

/** A UTF-8 character is at most 4 bytes, so a file this big cannot fit. */
const MAX_GPX_BYTES = ROUTE_MAX_GPX_CHARS * 4;

/**
 * Lets the person pick a GPX file and saves its track as a route. Resolves to
 * null when they close the picker without choosing.
 */
export async function pickAndImportGpx(): Promise<Route | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  const copy = new File(asset.uri);
  try {
    if (asset.size !== undefined && asset.size > MAX_GPX_BYTES) {
      throw new GpxFileTooLargeError();
    }
    const gpx = await copy.text();
    if (gpx.length > ROUTE_MAX_GPX_CHARS) throw new GpxFileTooLargeError();
    const { route } = await importGpxRoute({ gpx });
    await refreshRoutes();
    return route;
  } finally {
    // The picker copied the file into the cache; it is not needed afterwards.
    try {
      copy.delete();
    } catch {
      // Already gone, or not ours to delete.
    }
  }
}

/** Opens the share sheet with the route as a GPX file. False if dismissed. */
export function shareRouteGpx(route: Route): Promise<boolean> {
  const safeName =
    route.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'route';
  return shareGpxFile({
    xml: serializeGpx(route.name, route.points),
    fileName: `${safeName}.gpx`,
    title: route.name,
  });
}
