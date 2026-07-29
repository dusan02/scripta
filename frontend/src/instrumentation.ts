export async function register() {
  // Sentry disabled in dev — causes restart loops due to ESM module incompatibility
  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("../sentry.server.config");
    }
    if (process.env.NEXT_RUNTIME === "edge") {
      await import("../sentry.server.config");
    }
  }
}
