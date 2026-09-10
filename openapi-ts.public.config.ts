import { defineConfig } from "@hey-api/openapi-ts";

// Typed client for the public B2C contract (/api/public, public-openapi.json).
// A third semver lineage, no auth. src/public-client/ is generated — never
// hand-edited.
export default defineConfig({
	input: "public-openapi.json",
	output: "src/public-client",
	plugins: ["@hey-api/client-fetch"],
});
