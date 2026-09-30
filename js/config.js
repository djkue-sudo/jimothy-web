// Public configuration. Nothing here is secret: a CloudKit API token only works from the origins
// allowed for it in CloudKit Console, and only does what a signed-in visitor could do in the app.

export const CONFIG = {
  containerIdentifier: "iCloud.com.michaelmorales.Jimothy",

  // Production: Player.selfReported is deployed there (web/README.md).
  // A `?env=development` or `?env=production` query overrides this for testing.
  environment: "production",

  // Paste each token from CloudKit Console → API Access → API Tokens.
  apiTokens: {
    development: "d56b306f54450f98dd9ec1869162df89484bfb51d142f6549478b369d4072d7a",
    production: "9a43dbdc12c549f29e1aecc9dd2a0f75042593203e0b4eb0e1777f26239445b6",
  },
};

export function resolvedEnvironment() {
  const requested = new URLSearchParams(location.search).get("env");
  return requested === "development" || requested === "production" ? requested : CONFIG.environment;
}
