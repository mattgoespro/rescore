import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage } from "./error-message";

test("IPC errors show the main process message without Electron's prefix", () => {
  assert.equal(
    errorMessage(
      new Error(
        "Error invoking remote method 'library:import': Error: The file is not an IMDb export.",
      ),
      "Import failed",
    ),
    "The file is not an IMDb export.",
  );
  assert.equal(errorMessage(new Error("Plain"), "Fallback"), "Plain");
  assert.equal(errorMessage("not an error", "Fallback"), "Fallback");
  assert.equal(errorMessage(new Error(""), "Fallback"), "Fallback");
});
