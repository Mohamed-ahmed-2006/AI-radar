export const RADAR_PRIMARY_NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/models", label: "Models" },
  { href: "/optimizer", label: "Optimizer" },
  { href: "/changes", label: "Changes" },
  { href: "/sources", label: "Sources" },
  { href: "/my-stack", label: "My Stack" },
] as const;

export const ASK_NAV = { href: "/ask", label: "Ask" } as const;

/** Hash entries always target the dashboard, so they are never "the page". */
export function isRouteActive(pathname: string, href: string): boolean {
  if (href.includes("#")) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
