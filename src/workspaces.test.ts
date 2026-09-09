import type { Client } from "@hey-api/client-fetch";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceAccess } from "./client/types.gen";
import { resolveWorkspaceTargets, runAcrossWorkspaces } from "./workspaces";

const ws = (
	id: string,
	name: string,
	sections: string[] | null = null,
): WorkspaceAccess => ({ id, name, slug: id, role: "ADMIN", sections });

/** El X-Workspace-Id del client identifica contra qué workspace se llamó. */
function workspaceIdOf(client: Client): string | null {
	return (client.getConfig().headers as Headers).get("X-Workspace-Id");
}

describe("resolveWorkspaceTargets", () => {
	const accessible = [ws("a", "A"), ws("b", "B"), ws("c", "C")];
	const resolveWorkspaces = () => Promise.resolve(accessible);

	it("sin workspace no activa el modo global", async () => {
		expect(
			await resolveWorkspaceTargets(resolveWorkspaces, undefined),
		).toBeNull();
	});

	it('"all" resuelve a todos los workspaces accesibles de la sesión', async () => {
		expect(await resolveWorkspaceTargets(resolveWorkspaces, "all")).toEqual(
			accessible,
		);
	});

	it("descarta los workspaces con el acceso vencido o revocado", async () => {
		const withRevoked = () =>
			Promise.resolve([...accessible, ws("d", "D", [])]);
		expect(await resolveWorkspaceTargets(withRevoked, "all")).toEqual(
			accessible,
		);
		expect(await resolveWorkspaceTargets(withRevoked, ["d"])).toEqual([]);
	});

	it("descarta ids que no están entre los accesibles de la sesión", async () => {
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

	it("agrega las filas de cada workspace y las etiqueta con su origen", async () => {
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

	it("un workspace que falla no tumba el resto del fan-out", async () => {
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

	it("una excepción del client (no un error del envelope) también se aísla", async () => {
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
