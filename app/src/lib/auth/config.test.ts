import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocalAuthBind, authEnabled } from "./config";

test("authentication defaults on and only explicit false disables it", () => {
  const previous = process.env.AUTH_ENABLED;
  delete process.env.AUTH_ENABLED;
  try {
    for (const value of [undefined, "", "true", "0", "invalid"]) assert.equal(authEnabled(value), true);
    for (const value of ["false", " FALSE "]) assert.equal(authEnabled(value), false);
  } finally {
    if (previous === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = previous;
  }
});

test("local mode requires an explicit loopback bind at startup", () => {
  for (const command of ["dev", "start"]) {
    for (const hostname of ["127.0.0.1", "::1", "localhost"]) assert.doesNotThrow(() => assertLocalAuthBind([command, "-H", hostname], false));
    for (const args of [[command], [command, "-H", "0.0.0.0"], [command, "--hostname", "192.168.1.2"], [command, "-H", "::"]]) {
      assert.throws(() => assertLocalAuthBind(args, false), /explicit loopback bind/);
      assert.doesNotThrow(() => assertLocalAuthBind(args, true));
    }
  }
  assert.doesNotThrow(() => assertLocalAuthBind(["build"], false));
});
