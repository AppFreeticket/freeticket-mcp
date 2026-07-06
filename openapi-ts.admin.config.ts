import { defineConfig } from "@hey-api/openapi-ts";

// Cliente tipado del contrato superadmin (/api/admin, admin-openapi.json).
// Linaje semver separado del B2B. src/admin-client/ es generado — no se edita.
export default defineConfig({
	input: "admin-openapi.json",
	output: "src/admin-client",
	plugins: ["@hey-api/client-fetch"],
});
