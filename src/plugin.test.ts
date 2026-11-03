import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildServer, VERSION } from "./server";

/**
 * The repo doubles as a Claude Code plugin and as its own marketplace
 * (`/plugin marketplace add AppFreeticket/freeticket-mcp`). Nothing at runtime
 * reads these files, so a drifted version or a renamed plugin would only show
 * up when somebody fails to install it. `claude plugin validate .` is the
 * authoritative check; this keeps the cheap invariants in CI.
 */
const root = join(import.meta.dirname, "..");
const json = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

const pkg = json("package.json");
const plugin = json(".claude-plugin/plugin.json");
const marketplace = json(".claude-plugin/marketplace.json");
const mcp = json(".mcp.json");

describe("Claude plugin packaging", () => {
	it("plugin.json carries the package version (and so does the server)", () => {
		expect(plugin.version).toBe(pkg.version);
		expect(VERSION).toBe(pkg.version);
	});

	it("plugin.json has the metadata a listing needs", () => {
		expect(plugin.name).toBe("freeticket");
		expect(plugin.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		expect(plugin.license).toBe(pkg.license);
		expect(plugin.author?.name).toBe("FreeTicket");
		expect(() => new URL(plugin.homepage)).not.toThrow();
		expect(typeof plugin.description).toBe("string");
	});

	it("the marketplace lists this plugin from the repo root, under the same name", () => {
		expect(marketplace.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
		expect(marketplace.owner?.name).toBeTruthy();
		expect(marketplace.plugins).toHaveLength(1);
		const [entry] = marketplace.plugins;
		// Entry name = install id; it must match the manifest or the install
		// fails with `Plugin "<name>" not found in marketplace`.
		expect(entry.name).toBe(plugin.name);
		expect(entry.source).toBe("./");
		// plugin.json wins over an entry version and validate warns: keep one.
		expect(entry.version).toBeUndefined();
	});

	it(".mcp.json points at the remote HTTP server, with no credential in it", () => {
		const servers = Object.entries(mcp.mcpServers) as [
			string,
			{ type: string; url: string; headers?: unknown },
		][];
		expect(servers).toHaveLength(1);
		const [[name, server]] = servers;
		expect(name).toBe("freeticket");
		expect(server.type).toBe("http");
		expect(server.url).toBe("https://mcp.appfreeticket.com/mcp");
		// Auth is OAuth (src/handler.ts): a header here would be a pasted secret.
		expect(server.headers).toBeUndefined();
	});

	it("every skill has a SKILL.md whose name matches its folder", () => {
		const dirs = readdirSync(join(root, "skills"));
		expect(dirs.length).toBeGreaterThan(0);
		for (const dir of dirs) {
			const md = readFileSync(join(root, "skills", dir, "SKILL.md"), "utf8");
			const front = md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
			expect(front).toMatch(new RegExp(`^name: ${dir}$`, "m"));
			expect(front).toMatch(/^description: .{20,}$/m);
		}
	});

	it("skills only name tools the server registers", () => {
		const server = buildServer({
			apiUrl: "http://127.0.0.1:9",
			apiKey: "ft_test",
			adminSession: "test",
		});
		const tools = new Set(
			Object.keys(
				(server as unknown as { _registeredTools: Record<string, unknown> })
					._registeredTools,
			),
		);
		const unknown: string[] = [];
		let seen = 0;
		for (const dir of readdirSync(join(root, "skills"))) {
			const md = readFileSync(join(root, "skills", dir, "SKILL.md"), "utf8");
			// Backticked snake_case words with an underscore are tool names;
			// field names (`startsAt`) are camelCase and enum values are quoted.
			for (const [, name] of md.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
				seen++;
				if (!tools.has(name)) unknown.push(`${dir}: ${name}`);
			}
		}
		expect(seen).toBeGreaterThan(10);
		expect(unknown).toEqual([]);
	});
});
