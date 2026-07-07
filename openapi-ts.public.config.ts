import { defineConfig } from "@hey-api/openapi-ts";

// Cliente tipado del contrato público B2C (/api/public, public-openapi.json).
// Tercer linaje semver, sin auth. src/public-client/ es generado — no se edita.
export default defineConfig({
	input: "public-openapi.json",
	output: "src/public-client",
	plugins: ["@hey-api/client-fetch"],
});
