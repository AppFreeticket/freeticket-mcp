import { defineConfig } from "@hey-api/openapi-ts";

// Cliente tipado generado desde el contrato commiteado (openapi.json).
// src/client/ es generado — nunca se edita a mano. Lo sincroniza el agente
// `contract-sync` del paraguas ai-native cuando el backend cambia /api/v1.
export default defineConfig({
	input: "openapi.json",
	output: "src/client",
	plugins: ["@hey-api/client-fetch"],
});
