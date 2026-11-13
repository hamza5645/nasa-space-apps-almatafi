import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api.ts";
import { shouldRetry } from "./retry.ts";

test("4xx answers are not retried", () => {
  assert.equal(shouldRetry(0, new ApiError(422, "too_large", "too big")), false);
  assert.equal(shouldRetry(0, new ApiError(404, "not_found", "no such region")), false);
});

test("network failures and 5xx get one more try", () => {
  assert.equal(shouldRetry(0, new ApiError(0, "network", "offline")), true);
  assert.equal(shouldRetry(0, new ApiError(503, "data_unavailable", "not built")), true);
  assert.equal(shouldRetry(1, new ApiError(503, "data_unavailable", "not built")), false);
  assert.equal(shouldRetry(0, new Error("odd")), true);
});

test("an admin area the server hasn't fetched yet is tried a few more times", () => {
  const unknownAdmin = new ApiError(404, "not_found", "Unknown admin_id", { admin_id: "46179711B72666466596415" });
  assert.equal(shouldRetry(0, unknownAdmin), true);
  assert.equal(shouldRetry(2, unknownAdmin), true);
  assert.equal(shouldRetry(3, unknownAdmin), false);
});
