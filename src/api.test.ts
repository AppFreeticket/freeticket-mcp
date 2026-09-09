import { describe, expect, it } from "vitest";
import { run } from "./api";

describe("run() ante un fallo de transporte (#12)", () => {
	it("devuelve el mismo envelope con code network_error y retryable", async () => {
		// @hey-api/client-fetch solo puebla `error` cuando hubo respuesta HTTP.
		// Un DNS/timeout/TLS rechaza la promesa; sin catch el agente recibía
		// texto plano del SDK y no podía ramificar por código.
		const res = await run(Promise.reject(new Error("fetch failed")));
		expect(res.isError).toBe(true);
		const payload = JSON.parse(res.content[0].text) as {
			error: { code: string; message: string; retryable: boolean };
		};
		expect(payload.error.code).toBe("network_error");
		expect(payload.error.retryable).toBe(true);
		expect(payload.error.message).toContain("fetch failed");
	});

	it("una respuesta con error de la API sigue pasando tal cual", async () => {
		const res = await run(
			Promise.resolve({ error: { error: { code: "not_found" } } }),
		);
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("not_found");
	});
});
