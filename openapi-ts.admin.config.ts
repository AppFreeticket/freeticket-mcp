import { defineConfig } from "@hey-api/openapi-ts";

// Typed client for the superadmin contract (/api/admin, admin-openapi.json).
// Its semver lineage is separate from B2B. src/admin-client/ is generated —
// never hand-edited.
export default defineConfig({
	input: "admin-openapi.json",
	output: "src/admin-client",
	plugins: ["@hey-api/client-fetch"],
});
