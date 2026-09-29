// Server-only setting. Only an explicit false disables sign-in.
export function authEnabled(value = process.env.AUTH_ENABLED) {
  return value?.trim().toLowerCase() !== "false";
}

export function assertLocalAuthBind(args: string[], enabled = authEnabled()) {
  if (enabled || !args.some(arg => arg === "start" || arg === "dev")) return;
  const index = args.findIndex(arg => arg === "-H" || arg === "--hostname");
  const hostname = index < 0 ? undefined : args[index + 1];
  if (!hostname || !["127.0.0.1", "::1", "localhost"].includes(hostname)) {
    throw new Error("AUTH_ENABLED=false requires an explicit loopback bind (-H 127.0.0.1).");
  }
}
