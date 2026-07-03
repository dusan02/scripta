export function slugify(name: string | null | undefined): string {
  if (!name) return "firma";
  return name
    .toLowerCase()
    .replace(/[áä]/g, "a")
    .replace(/[éě]/g, "e")
    .replace(/[í]/g, "i")
    .replace(/[óô]/g, "o")
    .replace(/[úů]/g, "u")
    .replace(/[ý]/g, "y")
    .replace(/[ž]/g, "z")
    .replace(/[š]/g, "s")
    .replace(/[č]/g, "c")
    .replace(/[ř]/g, "r")
    .replace(/[ď]/g, "d")
    .replace(/[ť]/g, "t")
    .replace(/[ň]/g, "n")
    .replace(/[ľĺ]/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "firma";
}

export function buildCompanyUrl(ico: string, name: string | null | undefined): string {
  return `/firma/${ico}-${slugify(name)}`;
}

export function parseCompanySlug(param: string): { ico: string; slug: string } | null {
  const match = param.match(/^(\d{8,10})-(.+)$/);
  if (match) return { ico: match[1], slug: match[2] };
  const icoOnly = param.match(/^(\d{8,10})$/);
  if (icoOnly) return { ico: icoOnly[1], slug: "" };
  return null;
}
