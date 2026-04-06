const rateLimitMaps = new Map<string, Map<string, { count: number; resetAt: number }>>();

function getMap(route: string): Map<string, { count: number; resetAt: number }> {
  let map = rateLimitMaps.get(route);
  if (!map) {
    map = new Map();
    rateLimitMaps.set(route, map);
  }
  return map;
}

export function isRateLimited(
  ip: string,
  route: string,
  maxRequests: number = 3,
  windowMs: number = 60 * 60 * 1000
): boolean {
  const map = getMap(route);
  const now = Date.now();
  const entry = map.get(ip);

  if (!entry || now > entry.resetAt) {
    map.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (entry.count >= maxRequests) {
    return true;
  }

  entry.count++;
  return false;
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
