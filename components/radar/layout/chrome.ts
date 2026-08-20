export const COMMAND_PALETTE_ROUTES = [
  { href: "/", label: "Dashboard", hint: "G D", group: "Console" },
  { href: "/models", label: "Models", hint: "G M", group: "Intelligence" },
  { href: "/models/compare", label: "Compare", hint: "G C", group: "Intelligence" },
  { href: "/optimizer", label: "Optimizer", hint: "G O", group: "Intelligence" },
  { href: "/ask", label: "Ask", hint: "G A", group: "Intelligence" },
  { href: "/changes", label: "Changes", hint: "G N", group: "Temporal" },
  { href: "/my-stack", label: "My Stack", hint: "G S", group: "Temporal" },
  { href: "/sources", label: "Sources", hint: "G R", group: "Integrity" },
  { href: "/source-health", label: "Source Health", hint: "G H", group: "Integrity" },
  { href: "/demo/healing", label: "Healing Demo", hint: "G L", group: "Integrity" },
] as const;

export const SIDEBAR_GROUPS = [
  {
    label: "Console",
    items: [{ href: "/", label: "Dashboard" }],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/models", label: "Models" },
      { href: "/models/compare", label: "Compare" },
      { href: "/optimizer", label: "Optimizer" },
    ],
  },
  {
    label: "Temporal",
    items: [
      { href: "/changes", label: "Changes" },
      { href: "/my-stack", label: "My Stack" },
    ],
  },
  {
    label: "Integrity",
    items: [
      { href: "/sources", label: "Sources" },
      { href: "/source-health", label: "Source Health" },
      { href: "/demo/healing", label: "Healing Demo" },
    ],
  },
] as const;

export function pageContext(pathname: string): { title: string; status: string } {
  if (pathname === "/") return { title: "Intelligence Console", status: "Live fleet" };
  if (pathname.startsWith("/models/compare")) {
    return { title: "Compare", status: "Aligned observations" };
  }
  if (pathname.startsWith("/models/")) return { title: "Model detail", status: "Observed record" };
  if (pathname.startsWith("/models")) return { title: "Model explorer", status: "Catalog" };
  if (pathname.startsWith("/optimizer")) return { title: "Stack Optimizer", status: "Decision engine" };
  if (pathname.startsWith("/ask")) return { title: "Ask AI Radar", status: "Grounded evidence" };
  if (pathname.startsWith("/changes")) return { title: "Change feed", status: "Temporal intelligence" };
  if (pathname.startsWith("/my-stack")) return { title: "My Stack", status: "Local watchlist" };
  if (pathname.startsWith("/source-health")) {
    return { title: "Source Health", status: "Sentinel" };
  }
  if (pathname.startsWith("/sources/")) return { title: "Source detail", status: "Provenance" };
  if (pathname.startsWith("/sources")) return { title: "Sources", status: "Collection registry" };
  if (pathname.startsWith("/demo/healing")) {
    return { title: "Healing Demo", status: "SourcePulse" };
  }
  return { title: "AI Radar", status: "Ecosystem intelligence" };
}
