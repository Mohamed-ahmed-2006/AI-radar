import { formatContextWindow, formatCurrency } from "../../radar/utils";
import type { ObservedBoolean } from "../../../lib/product/explorer";

export function formatObservedPrice(amount: number | null): string {
  if (amount === null) return "—";
  return formatCurrency(amount);
}

export function formatObservedTokens(tokens: number | null): string {
  if (tokens === null) return "—";
  return formatContextWindow(tokens);
}

export function formatModalities(values: readonly string[]): string {
  if (values.length === 0) return "Not observed";
  return values.join(", ");
}

export function capabilityTone(
  value: ObservedBoolean,
): "supported" | "unsupported" | "unknown" {
  if (value.observed === true) return "supported";
  if (value.observed === false) return "unsupported";
  return "unknown";
}
