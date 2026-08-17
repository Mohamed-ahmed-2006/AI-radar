import assert from "node:assert/strict";
import test from "node:test";

import { dedupeChangeEventInputs, type ChangeEventInput } from "../../lib/supabase";

const base: ChangeEventInput = {
  providerId: "provider", runId: "run", modelId: "model", changeType: "price_increased",
  fieldName: "inputPricePer1MTokens", oldValue: 1, newValue: 2,
};

test("event persistence keeps short and long conflict identities distinct", () => {
  const inputs = dedupeChangeEventInputs([
    { ...base, pricingMode: "standard", contextTier: "short" },
    { ...base, pricingMode: "standard", contextTier: "long" },
  ]);
  assert.equal(inputs.length, 2);
});

test("event persistence removes only exact duplicate conflict rows", () => {
  const input = { ...base, pricingMode: "standard", contextTier: "short" };
  assert.equal(dedupeChangeEventInputs([input, input]).length, 1);
  assert.throws(
    () => dedupeChangeEventInputs([input, { ...input, newValue: 3 }]),
    /Non-identical change events share database identity/,
  );
});
