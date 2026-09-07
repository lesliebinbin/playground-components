// This snapshot keeps the standalone Playground build independent of the backend repository.
import rawFeatureFlags from "../config/feature-flags.json";

// Embed the feature flags in the playground app
const embedFeatureFlags = () => {
  // @ts-ignore
  window.FEATURE_FLAGS = window.FEATURE_FLAGS ?? {};
  const featureFlags = JSON.parse(JSON.stringify(rawFeatureFlags));

  for (const flag of Object.values(featureFlags.flags)) {
    // @ts-ignore
    window.FEATURE_FLAGS[flag.key] = flag.on;
  }
};

embedFeatureFlags();
