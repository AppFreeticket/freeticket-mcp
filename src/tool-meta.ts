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
 * leaves FreeTicket, and "leaves" counts every side effect free-admin fires
 * server-side, not just the HTTP call the tool makes: a payment gateway
 * (Mercado Pago or Stripe — charges, refunds, and cancelling a recurring
 * subscription or a platform plan there), an outbound email or WhatsApp to a
 * person (invitations, tickets, notifications), a third-party service (Mux,
 * seats.io), an outbound webhook to a URL the user controls, or making
 * something visible on the public web (publishing an event, a product, the
 * organization page or a store item: anonymous buyers and search engines
 * see it). Before marking a write closed-world, read its route in
 * free-admin: `staff_create` looks local but emails the invite.
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
