import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	ACCESS_PREFIX,
	CODE_PREFIX,
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
