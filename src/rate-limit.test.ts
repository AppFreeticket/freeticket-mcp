import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { clientIp, ipKey, RateLimiter } from "./handler";

process.env.MCP_TOKEN_SECRET ??= "test-secret-rate-limit";

afterEach(() => {
	delete process.env.VERCEL;
});

describe("RateLimiter", () => {
	it("resets when the window ends", () => {
		const l = new RateLimiter(2, 1000);
		expect(l.check("a", 0)).toBe(0);
		expect(l.check("a", 100)).toBe(0);
		expect(l.check("a", 200)).toBe(1);
		expect(l.check("a", 1000)).toBe(0);
	});

	it("counts each key on its own", () => {
		const l = new RateLimiter(1, 1000);
		expect(l.check("a", 0)).toBe(0);
		expect(l.check("b", 0)).toBe(0);
		expect(l.check("a", 1)).toBeGreaterThan(0);
		expect(l.check("b", 1)).toBeGreaterThan(0);
	});

	it("never holds more than maxKeys counters, evicting the oldest", () => {
		const l = new RateLimiter(1, 60_000, 3);
		for (const k of ["a", "b", "c"]) l.check(k, 0);
		expect(l.check("a", 1)).toBeGreaterThan(0);
		for (let i = 0; i < 100; i++) l.check(`k${i}`, 2);
		expect(l.size).toBe(3);
		// "a" was evicted: its counter starts over.
		expect(l.check("a", 3)).toBe(0);
	});
});

describe("ipKey", () => {
	it("groups IPv6 by /64 and keeps IPv4 as is", () => {
		expect(ipKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
		expect(ipKey("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
		expect(ipKey("2001:0db8:0001:0002::")).toBe("2001:db8:1:2::/64");
		expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
		expect(ipKey("2001:db8:1:3::1")).not.toBe(ipKey("2001:db8:1:2::1"));
		expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
		expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
	});
});

describe("clientIp", () => {
	const req = (headers: Record<string, string>) =>
		({
			headers,
			socket: { remoteAddress: "10.0.0.1" },
		}) as unknown as IncomingMessage;

	it("trusts X-Forwarded-For only on Vercel", () => {
		const r = req({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" });
		expect(clientIp(r)).toBe("10.0.0.1");
		process.env.VERCEL = "1";
		expect(clientIp(r)).toBe("203.0.113.9");
		expect(clientIp(req({ "x-forwarded-for": "2001:db8:1:2::7" }))).toBe(
			"2001:db8:1:2::/64",
		);
	});
});
