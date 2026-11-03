import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test-only helpers that read the three OpenAPI specs and the tool sources.
 * Shared by coverage.test.ts (which operations have a tool) and
 * annotations.test.ts (which HTTP methods each tool calls). Not imported by
 * the server: tsup only bundles the entry points.
 */
export const root = join(import.meta.dirname, "..", "..");

export const SPECS = [
	"openapi.json",
	"admin-openapi.json",
	"public-openapi.json",
] as const;
export type SpecFile = (typeof SPECS)[number];

/** Generated SDK folder (src/<dir>/sdk.gen.ts) → the spec it was built from. */
const SPEC_OF_CLIENT: Record<string, SpecFile> = {
	client: "openapi.json",
	"admin-client": "admin-openapi.json",
	"public-client": "public-openapi.json",
};

export type Op = {
	id: string;
	method: string;
	where: string;
	/** `x-ft-mcp: { expose: false }` reason, when the contract hides it. */
	hidden?: string;
};

export function operations(specFile: SpecFile): Op[] {
	const spec = JSON.parse(readFileSync(join(root, specFile), "utf8")) as {
		paths: Record<
			string,
			Record<
				string,
				{
					operationId?: string;
					"x-ft-mcp"?: { expose?: boolean; reason?: string };
				}
			>
		>;
	};
	const out: Op[] = [];
	for (const [path, item] of Object.entries(spec.paths ?? {}))
		for (const [method, op] of Object.entries(item)) {
			if (!["get", "post", "patch", "put", "delete"].includes(method)) continue;
			if (!op.operationId) continue;
			const mcp = op["x-ft-mcp"];
			out.push({
				id: op.operationId,
				method: method.toUpperCase(),
				where: `${method.toUpperCase()} ${path}`,
				...(mcp?.expose === false
					? { hidden: mcp.reason?.trim() || "(no reason)" }
					: {}),
			});
		}
	return out;
}

/** Every non-test source under src/tools, so a new tool file is never skipped. */
export function toolFiles(): { file: string; text: string }[] {
	const dir = join(root, "src", "tools");
	return readdirSync(dir)
		.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
		.map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));
}

const REGISTRATION =
	/(?:server\.(?:tool|registerTool)|uiTool)\(\s*(?:server,\s*)?"([a-z0-9_]+)"/g;

/**
 * Tool name → the spec operations its registration calls. The operations of a
 * tool are the generated SDK calls (`opId(`) between its registration and the
 * next one, resolved against the spec of the SDK the file imports — so a name
 * that exists in two specs (`getMe`, `postWorkspaces`) resolves to the right
 * method.
 */
export function toolOperations(): Map<string, { file: string; ops: Op[] }> {
	const out = new Map<string, { file: string; ops: Op[] }>();
	for (const { file, text } of toolFiles()) {
		const known = new Map<string, Op>();
		for (const [, dir] of text.matchAll(/from "\.\.\/([a-z-]+)\/sdk\.gen"/g)) {
			const spec = SPEC_OF_CLIENT[dir];
			if (!spec) throw new Error(`${file}: unknown generated client ${dir}`);
			for (const op of operations(spec)) known.set(op.id, op);
		}
		const regs = [...text.matchAll(REGISTRATION)];
		regs.forEach((r, i) => {
			if (out.has(r[1])) throw new Error(`tool ${r[1]} registered twice`);
			const body = text.slice(r.index, regs[i + 1]?.index ?? text.length);
			const ids = new Set(
				[...body.matchAll(/\b([a-z][A-Za-z0-9]*)\(/g)].map((m) => m[1]),
			);
			const ops = [...ids].flatMap((id) => known.get(id) ?? []);
			out.set(r[1], { file, ops });
		});
	}
	return out;
}
