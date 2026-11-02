import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** `admin_workspaces_get` → "Admin workspaces get". */
export function toolTitle(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " ");
}

/**
 * Directory metadata for a read. The four booleans are always present:
 * ChatGPT rejects a tool that omits one (#37).
 */
export function read(name: string): ToolAnnotations {
	return {
		title: toolTitle(name),
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	};
}

/**
 * Directory metadata for a write. `openWorld` is true only when the call
 * leaves FreeTicket (Mercado Pago or an outbound email).
 */
export function write(
	name: string,
	flags: { destructive: boolean; idempotent?: boolean; openWorld?: boolean },
): ToolAnnotations {
	return {
		title: toolTitle(name),
		readOnlyHint: false,
		destructiveHint: flags.destructive,
		idempotentHint: flags.idempotent ?? false,
		openWorldHint: flags.openWorld ?? false,
	};
}
