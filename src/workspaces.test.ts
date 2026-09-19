import type { Client } from "@hey-api/client-fetch";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceAccess } from "./client/types.gen";
import {
	resolveWorkspaceTargets,
	runAcrossWorkspaces,
	runWorkspaceList,
	splitLimit,
} from "./workspaces";

const ws = (
	id: string,
	name: string,
	sections: string[] | null = null,
): WorkspaceAccess => ({ id, name, slug: id, role: "ADMIN", sections });

/** The client's X-Workspace-Id identifies which workspace was called. */
function workspaceIdOf(client: Client): string | null {
	return (client.getConfig().headers as Headers).get("X-Workspace-Id");
}

describe("resolveWorkspaceTargets", () => {
	const accessible = [ws("a", "A"), ws("b", "B"), ws("c", "C")];
	const resolveWorkspaces = () => Promise.resolve(accessible);

	it("does not turn on global mode without workspace", async () => {
		expect(
			await resolveWorkspaceTargets(resolveWorkspaces, undefined),
		).toBeNull();
	});

	it('"all" resolves to every workspace the session can reach', async () => {
		expect(await resolveWorkspaceTargets(resolveWorkspaces, "all")).toEqual(
			accessible,
		);
	});

	it("drops workspaces whose access is expired or revoked", async () => {
		const withRevoked = () =>
			Promise.resolve([...accessible, ws("d", "D", [])]);
		expect(await resolveWorkspaceTargets(withRevoked, "all")).toEqual(
			accessible,
		);
		expect(await resolveWorkspaceTargets(withRevoked, ["d"])).toEqual([]);
	});

	it("drops ids that are not among the ones the session can reach", async () => {
		const targets = await resolveWorkspaceTargets(resolveWorkspaces, [
			"a",
			"no-accesible",
			"c",
		]);
		expect(targets).toEqual([ws("a", "A"), ws("c", "C")]);
	});
});

describe("runAcrossWorkspaces", () => {
	const targets = [ws("a", "A"), ws("b", "B"), ws("c", "C")];
	const creds = { apiUrl: "http://localhost", apiKey: "k" };

	it("aggregates the rows of each workspace and tags them with their origin", async () => {
		const fn = vi.fn(async (client: Client) => {
			const wsId = workspaceIdOf(client);
			return { data: { data: [{ id: `evt-${wsId}` }] } };
		});

		const { rows, errors } = await runAcrossWorkspaces(creds, targets, fn);

		expect(errors).toEqual([]);
		expect(rows).toHaveLength(3);
		expect(rows).toContainEqual({
			id: "evt-a",
			workspaceId: "a",
			workspaceName: "A",
		});
		expect(rows).toContainEqual({
			id: "evt-b",
			workspaceId: "b",
			workspaceName: "B",
		});
		expect(rows).toContainEqual({
			id: "evt-c",
			workspaceId: "c",
			workspaceName: "C",
		});
	});

	it("one failing workspace does not take down the rest of the fan-out", async () => {
		const fn = vi.fn(async (client: Client) => {
			const wsId = workspaceIdOf(client);
			if (wsId === "b") return { error: { code: "FORBIDDEN" } };
			return { data: { data: [{ id: `evt-${wsId}` }] } };
		});

		const { rows, errors } = await runAcrossWorkspaces(creds, targets, fn);

		expect(rows.map((r) => r.workspaceId).sort()).toEqual(["a", "c"]);
		expect(errors).toEqual([
			{ workspaceId: "b", workspaceName: "B", error: { code: "FORBIDDEN" } },
		]);
	});

	it("a client exception (not an envelope error) is isolated too", async () => {
		const fn = vi.fn(async (client: Client) => {
			const wsId = workspaceIdOf(client);
			if (wsId === "a") throw new Error("network down");
			return { data: { data: [{ id: `evt-${wsId}` }] } };
		});

		const { rows, errors } = await runAcrossWorkspaces(creds, targets, fn);

		expect(rows.map((r) => r.workspaceId).sort()).toEqual(["b", "c"]);
		expect(errors).toEqual([
			{ workspaceId: "a", workspaceName: "A", error: "network down" },
		]);
	});
});

describe("workspace ids that do not resolve (#13)", () => {
	const accessible = [ws("a", "A"), ws("b", "B")];
	const ctx = {
		client: {} as Client,
		creds: { apiUrl: "http://localhost", apiKey: "test" },
		resolveWorkspaces: () => Promise.resolve(accessible),
	};

	it("reports them as an error instead of dropping them silently", async () => {
		const res = await runWorkspaceList(
			ctx,
			["a", "ws_typo"],
			undefined,
			async () => ({ data: { data: [{ id: "row1" }] } }),
		);
		const payload = JSON.parse(res.content[0].text) as {
			data: unknown[];
			errors: { workspaceId: string; error: { code: string } }[];
		};
		// The rows from the good workspace still arrive...
		expect(payload.data).toHaveLength(1);
		// ...and the bad id no longer vanishes without a trace.
		expect(payload.errors).toHaveLength(1);
		expect(payload.errors[0].workspaceId).toBe("ws_typo");
		expect(payload.errors[0].error.code).toBe("workspace_not_accessible");
	});

	it('"all" no inventa ids no resueltos', async () => {
		const res = await runWorkspaceList(ctx, "all", undefined, async () => ({
			data: { data: [] },
		}));
		const payload = JSON.parse(res.content[0].text) as { errors: unknown[] };
		expect(payload.errors).toHaveLength(0);
	});
});

describe("every workspace is the default, not one", () => {
	const two = [ws("a", "A"), ws("b", "B")];
	// The session client as the pinned path uses it: its header is whatever the
	// session was built with, not one the fan-out set.
	const sessionClient = {
		getConfig: () => ({ headers: new Headers() }),
	} as unknown as Client;
	const base = {
		client: sessionClient,
		creds: { apiUrl: "http://localhost", apiKey: "k" },
		resolveWorkspaces: () => Promise.resolve(two),
	};
	/** A list fn that reports which workspace (and limit) it was called with. */
	const probe = () =>
		vi.fn(async (client: Client, limit: string | undefined) => ({
			data: {
				data: [{ id: `row-${workspaceIdOf(client) ?? "session"}`, limit }],
			},
		}));

	it("fans out across every reachable workspace with no `workspace` argument", async () => {
		const fn = probe();
		const res = await runWorkspaceList(base, undefined, undefined, fn);
		const payload = JSON.parse(res.content[0].text) as {
			data: { workspaceId: string }[];
		};
		expect(payload.data.map((r) => r.workspaceId).sort()).toEqual(["a", "b"]);
	});

	it("a pinned session stays on its workspace", async () => {
		const fn = probe();
		const res = await runWorkspaceList(
			{ ...base, creds: { ...base.creds, workspaceId: "a" } },
			undefined,
			undefined,
			fn,
		);
		// The session client, untouched: no fan-out, no workspace tags.
		expect(fn).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(res.content[0].text) as {
			data: { workspaceId?: string }[];
		};
		expect(payload.data[0].workspaceId).toBeUndefined();
	});

	it("one reachable workspace keeps the single-workspace path (and its `page`)", async () => {
		const fn = vi.fn(async () => ({
			data: { data: [{ id: "row1" }], page: { hasMore: false } },
		}));
		const res = await runWorkspaceList(
			{ ...base, resolveWorkspaces: () => Promise.resolve([ws("a", "A")]) },
			undefined,
			undefined,
			fn,
		);
		const payload = JSON.parse(res.content[0].text) as {
			page?: unknown;
			errors?: unknown;
		};
		expect(payload.page).toEqual({ hasMore: false });
		expect(payload.errors).toBeUndefined();
	});

	it("an unreachable /me falls back to the session, it does not invent an empty list", async () => {
		const fn = vi.fn(async () => ({ data: { data: [{ id: "row1" }] } }));
		const res = await runWorkspaceList(
			{ ...base, resolveWorkspaces: () => Promise.resolve([]) },
			undefined,
			undefined,
			fn,
		);
		expect(fn).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(res.content[0].text) as { data: unknown[] };
		expect(payload.data).toHaveLength(1);
	});
});

describe("splitLimit", () => {
	it("spreads the asked-for limit across the workspaces queried", () => {
		expect(splitLimit("20", 4)).toBe("5");
		// Rounds up: nobody gets a limit of zero.
		expect(splitLimit("3", 4)).toBe("1");
	});

	it("leaves a single target, an absent limit or a nonsense one alone", () => {
		expect(splitLimit("20", 1)).toBe("20");
		expect(splitLimit(undefined, 4)).toBeUndefined();
		expect(splitLimit("abc", 4)).toBe("abc");
	});

	it("trims the aggregate back to the limit the caller asked for", async () => {
		const three = [ws("a", "A"), ws("b", "B"), ws("c", "C")];
		const res = await runWorkspaceList(
			{
				client: {} as Client,
				creds: { apiUrl: "http://localhost", apiKey: "k" },
				resolveWorkspaces: () => Promise.resolve(three),
			},
			undefined,
			"4",
			// limit 4 over 3 workspaces = 2 each = 6 rows before trimming.
			async (_c, limit) => ({
				data: {
					data: Array.from({ length: Number(limit) }, (_, i) => ({ i })),
				},
			}),
		);
		const payload = JSON.parse(res.content[0].text) as { data: unknown[] };
		expect(payload.data).toHaveLength(4);
	});
});
