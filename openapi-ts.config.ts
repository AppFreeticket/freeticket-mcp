import { defineConfig } from "@hey-api/openapi-ts";

// Typed client generated from the committed contract (openapi.json).
// src/client/ is generated — never hand-edited. The ai-native umbrella's
// `contract-sync` agent syncs it when the backend changes /api/v1.
export default defineConfig({
	input: "openapi.json",
	output: "src/client",
	plugins: ["@hey-api/client-fetch"],
});
