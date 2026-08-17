import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MockDataBadge } from "../../components/radar/layout/MockDataBadge";

test("mock badge renders only for the explicit fixture state", () => {
  assert.equal(
    renderToStaticMarkup(createElement(MockDataBadge, { isMock: false })),
    "",
  );
  assert.match(
    renderToStaticMarkup(createElement(MockDataBadge, { isMock: true })),
    /MOCK DATA/,
  );
});
