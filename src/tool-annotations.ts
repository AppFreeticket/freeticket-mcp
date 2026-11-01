import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/** Explicit directory metadata; hints describe behavior, not authorization. */
export function toolAnnotations(
	name: string,
	readOnlyHint: boolean,
	existing: Pick<ToolAnnotations, "destructiveHint" | "idempotentHint"> = {},
): ToolAnnotations {
	const words = name.replace(/^(admin|public)_/, "$1: ").replaceAll("_", " ");
	const title = words.charAt(0).toUpperCase() + words.slice(1);
	return {
		title,
		readOnlyHint,
		destructiveHint: false,
		idempotentHint: readOnlyHint,
		// Even public reads access the live FreeTicket API outside the host.
		openWorldHint: true,
		...existing,
	};
}
