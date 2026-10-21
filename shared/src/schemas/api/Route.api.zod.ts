import { z } from 'zod';
import {
  routeActivitySchema,
  routeSourceSchema,
} from '../database/Routes.zod.ts';

/** The most points a client may send; the server simplifies to far fewer. */
export const ROUTE_MAX_INPUT_POINTS = 50000;
/** The most points a stored route keeps. */
export const ROUTE_MAX_STORED_POINTS = 2000;
/** The most routes one person can keep. */
export const ROUTE_MAX_PER_USER = 200;
/** The largest GPX file (characters) the import endpoint accepts. */
export const ROUTE_MAX_GPX_CHARS = 10_000_000;

export const routePointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Altitude in metres. */
  alt: z.number().min(-1000).max(10000).optional(),
});

/**
 * A turn instruction. `index` is the point in `points` where it applies, so a
 * device can fire the cue when it gets close to that point.
 */
export const routeCueKindSchema = z.enum([
  'depart',
  'straight',
  'slight_left',
  'left',
  'sharp_left',
  'slight_right',
  'right',
  'sharp_right',
  'uturn',
  'arrive',
]);

export const routeCueSchema = z.object({
  index: z.number().int().min(0),
  kind: routeCueKindSchema,
  text: z.string().trim().max(120).optional(),
  /** Metres from the start of the route to this cue. */
  distanceM: z.number().min(0).optional(),
});

export const routeNameSchema = z.string().trim().min(1).max(100);

export const routeSchema = z.object({
  id: z.string(),
  name: z.string(),
  activity: routeActivitySchema,
  source: routeSourceSchema,
  distanceM: z.number(),
  elevationGainM: z.number().nullable(),
  points: z.array(routePointSchema),
  cues: z.array(routeCueSchema),
  sourceExerciseEntryId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A route in a list: everything but the (large) points and cues. */
export const routeSummarySchema = routeSchema
  .omit({ points: true, cues: true })
  .extend({
    /** First point, for placing the route on a map. */
    start: routePointSchema.nullable(),
    pointCount: z.number().int(),
  });

export const createRouteBodySchema = z.object({
  name: routeNameSchema,
  activity: routeActivitySchema.default('run'),
  points: z.array(routePointSchema).min(2).max(ROUTE_MAX_INPUT_POINTS),
  cues: z.array(routeCueSchema).max(1000).optional(),
});

export const updateRouteBodySchema = z
  .object({
    name: routeNameSchema.optional(),
    activity: routeActivitySchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.activity !== undefined, {
    message: 'Provide a name or an activity',
  });

export const importGpxRouteBodySchema = z.object({
  gpx: z.string().min(1).max(ROUTE_MAX_GPX_CHARS),
  /** Overrides the name found in the file. */
  name: routeNameSchema.optional(),
  activity: routeActivitySchema.default('run'),
});

export const routeFromActivityBodySchema = z.object({
  name: routeNameSchema.optional(),
  activity: routeActivitySchema.optional(),
});

export type RoutePoint = z.infer<typeof routePointSchema>;
export type RouteCueKind = z.infer<typeof routeCueKindSchema>;
export type RouteCue = z.infer<typeof routeCueSchema>;
export type Route = z.infer<typeof routeSchema>;
export type RouteSummary = z.infer<typeof routeSummarySchema>;
export type CreateRouteBody = z.infer<typeof createRouteBodySchema>;
export type UpdateRouteBody = z.infer<typeof updateRouteBodySchema>;
export type ImportGpxRouteBody = z.infer<typeof importGpxRouteBodySchema>;
export type RouteFromActivityBody = z.infer<typeof routeFromActivityBodySchema>;
