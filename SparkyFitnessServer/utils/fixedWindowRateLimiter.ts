import type { NextFunction, Request, Response } from 'express';

/**
 * In-memory fixed-window rate limiter for the few endpoints that are reachable
 * without credentials (watch pairing). Per server process, which matches the
 * single-container deployment; it is a brake on guessing and flooding, not an
 * accounting mechanism. Keys default to the client IP, which honours the
 * app's `trust proxy` setting.
 */
export function fixedWindowRateLimit(options: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  now?: () => number;
}) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  const keyOf = options.key ?? ((req: Request) => req.ip ?? 'unknown');

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const t = now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + options.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > options.max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - t) / 1000)));
      return res.status(429).json({ error: 'Too many requests.' });
    }
    next();
  };
}
