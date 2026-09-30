// Public configuration. Nothing here is secret: a CloudKit API token only works from the origins
// allowed for it in CloudKit Console, and only does what a signed-in visitor could do in the app.

export const CONFIG = {
  containerIdentifier: "iCloud.com.michaelmorales.Jimothy",

  // Stay on Development until Player.selfReported is deployed to Production (web/README.md).
  // A `?env=development` or `?env=production` query overrides this for testing.
  environment: "development",

  // Paste each token from CloudKit Console → API Access → API Tokens.
  apiTokens: {
    development: "",
    production: "",
  },
};

export function resolvedEnvironment() {
  const requested = new URLSearchParams(location.search).get("env");
  return requested === "development" || requested === "production" ? requested : CONFIG.environment;
}
