import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	ACCESS_PREFIX,
	CLIENT_PREFIX,
	CODE_PREFIX,
	checkRedirect,
	consentPage,
	open,
	pkceMatches,
	seal,
	sealedToCreds,
} from "./oauth";

const SECRET = "test-secret";

describe("seal/open", () => {
	it("roundtrips credentials", () => {
		const token = seal(
			{ k: "ftk_abc", w: "ws_1", a: "sess", exp: Date.now() / 1000 + 60 },
			SECRET,
			ACCESS_PREFIX,
		);
		expect(token.startsWith(ACCESS_PREFIX)).toBe(true);
		const p = open(token, SECRET, ACCESS_PREFIX);
		expect(p).toMatchObject({ k: "ftk_abc", w: "ws_1", a: "sess" });
	});

	it("rejects expired tokens", () => {
		const token = seal(
			{ k: "x", exp: Date.now() / 1000 - 1 },
			SECRET,
			ACCESS_PREFIX,
		);
		expect(open(token, SECRET, ACCESS_PREFIX)).toBeNull();
	});

	it("rejects wrong secret, wrong prefix and tampering", () => {
		const token = seal(
			{ k: "x", exp: Date.now() / 1000 + 60 },
			SECRET,
			ACCESS_PREFIX,
		);
		expect(open(token, "other-secret", ACCESS_PREFIX)).toBeNull();
		expect(open(token, SECRET, CODE_PREFIX)).toBeNull();
		expect(open(`${token.slice(0, -2)}zz`, SECRET, ACCESS_PREFIX)).toBeNull();
		expect(open("ftmcp_garbage", SECRET, ACCESS_PREFIX)).toBeNull();
	});
});

describe("pkce", () => {
	it("matches S256 verifier/challenge and rejects mismatch", () => {
		const verifier = randomBytes(32).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		expect(pkceMatches(verifier, challenge)).toBe(true);
		expect(pkceMatches("wrong", challenge)).toBe(false);
	});
});

describe("sealedToCreds", () => {
	it("maps sealed payload to session creds, dropping empties", () => {
		const c = sealedToCreds({ k: "key", w: "", a: "adm", exp: 0 }, "https://x");
		expect(c).toEqual({
			apiUrl: "https://x",
			apiKey: "key",
			workspaceId: undefined,
			adminSession: "adm",
		});
	});
});

describe("asForm", () => {
	it("accepts raw urlencoded strings and pre-parsed objects (Vercel)", async () => {
		const { asForm } = await import("./handler");
		expect(asForm("a=1&b=2").get("b")).toBe("2");
		expect(asForm({ a: "1", b: "2", n: 3 }).get("b")).toBe("2");
		expect(asForm(undefined).toString()).toBe("");
	});
});

describe("checkRedirect", () => {
	const client = (rus: string[]) =>
		seal(
			{ rus, n: "Claude", exp: Date.now() / 1000 + 60 },
			SECRET,
			CLIENT_PREFIX,
		);

	it("accepts only the redirect_uris sealed into the client_id", () => {
		const id = client(["https://claude.ai/api/mcp/auth_callback"]);
		expect(
			checkRedirect(id, "https://claude.ai/api/mcp/auth_callback", SECRET),
		).toMatchObject({ ok: true, clientName: "Claude", host: "claude.ai" });
		// A legitimate client_id cannot carry the code to another host.
		expect(checkRedirect(id, "https://evil.example/cb", SECRET).ok).toBe(false);
	});

	it("limits unsealed (legacy) client_ids to known hosts and loopback", () => {
		expect(
			checkRedirect("ftmcp-0123", "https://chatgpt.com/cb", SECRET).ok,
		).toBe(true);
		expect(
			checkRedirect("ftmcp-0123", "http://127.0.0.1:5173/cb", SECRET).ok,
		).toBe(true);
		expect(
			checkRedirect("ftmcp-0123", "https://evil.example/cb", SECRET).ok,
		).toBe(false);
		expect(checkRedirect("", "javascript:alert(1)", SECRET).ok).toBe(false);
	});

	it("flags destinations that are not a known client", () => {
		const id = client(["https://my-agent.example/cb"]);
		expect(
			checkRedirect(id, "https://my-agent.example/cb", SECRET),
		).toMatchObject({ ok: true, unknownHost: true });
	});
});

describe("consentPage", () => {
	it("cannot be broken out of its inline script by query params", () => {
		const page = consentPage(
			new URLSearchParams({
				state: "</script><script>alert(1)</script>",
				redirect_uri: "https://claude.ai/cb",
			}),
			{
				device: {
					device_code: "dc",
					user_code: "ABCD",
					verification_uri_complete: "https://x/verify",
					interval: 5,
					expires_in: 600,
				},
			},
		);
		expect(page).not.toContain("<script>alert(1)");
	});

	it("names the destination host and warns about unknown ones", () => {
		const page = consentPage(new URLSearchParams(), {
			redirect: { ok: true, host: "evil.example", unknownHost: true },
		});
		expect(page).toContain("evil.example");
		expect(page).toContain("no es un cliente conocido");
	});
});
