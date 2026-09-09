import { describe, expect, it } from "vitest";
import { run } from "./api";

describe("run() ante un fallo de transporte (#12)", () => {
	it("returns the same envelope with a network_error code and retryable", async () => {
		// @hey-api/client-fetch only populates `error` when there was an HTTP
		// response. A DNS, timeout or TLS failure rejects the promise; without the
		// catch the agent got plain SDK text and could not branch on a code.
		const res = await run(Promise.reject(new Error("fetch failed")));
		expect(res.isError).toBe(true);
		const payload = JSON.parse(res.content[0].text) as {
			error: { code: string; message: string; retryable: boolean };
		};
		expect(payload.error.code).toBe("network_error");
		expect(payload.error.retryable).toBe(true);
		expect(payload.error.message).toContain("fetch failed");
	});

	it("an API error response still passes through unchanged", async () => {
		const res = await run(
			Promise.resolve({ error: { error: { code: "not_found" } } }),
		);
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("not_found");
	});
});
