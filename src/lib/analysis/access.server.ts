import "server-only";

export function publicAIEnabled(request: Request): boolean {
  if (process.env.INSIGHTFLOW_ENABLE_PUBLIC_AI === "true") return true;
  // A deployed function must never treat a client-controlled host as local authorization.
  if (process.env.VERCEL) return false;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    new URL(request.url).hostname,
  );
}
