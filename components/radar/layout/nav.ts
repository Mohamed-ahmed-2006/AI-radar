export const RADAR_PRIMARY_NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/models", label: "Models" },
  { href: "/changes", label: "Changes" },
  { href: "/my-stack", label: "My Stack" },
  { href: "/sources", label: "Sources" },
] as const;

/** Compact second row so Compare, Optimizer, Source Health and Healing stay discoverable. */
export const RADAR_SECONDARY_NAV = [
  { href: "/models/compare", label: "Compare" },
  { href: "/optimizer", label: "Optimizer" },
  { href: "/source-health", label: "Source Health" },
  { href: "/demo/healing", label: "Healing Demo" },
] as const;

export const ASK_NAV = { href: "/ask", label: "Ask" } as const;

/** Judge-facing product path. Every hop is an existing route. */
export const PRODUCT_TOUR = [
  { href: "/", label: "Dashboard" },
  { href: "/models", label: "Explorer" },
  { href: "/models/compare", label: "Compare" },
  { href: "/optimizer", label: "Optimizer" },
  { href: "/ask", label: "Ask" },
  { href: "/changes", label: "Changes" },
  { href: "/source-health", label: "Source Health" },
  { href: "/demo/healing", label: "Healing Demo" },
] as const;

/** Hash entries always target the dashboard, so they are never "the page". */
export function isRouteActive(pathname: string, href: string): boolean {
  if (href.includes("#")) return false;
  if (href === "/") return pathname === "/";
  if (href === "/models") {
    return (
      pathname === "/models" ||
      (pathname.startsWith("/models/") && !pathname.startsWith("/models/compare"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
