import { randomUUID } from "node:crypto";
import type { Client } from "@hey-api/client-fetch";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { run } from "../api";
import {
	deleteCustomerCommunityCommentsId,
	deleteCustomerCommunityMeetupsIdRsvp,
	deleteCustomerCommunityPostsIdReactions,
	getCustomerCommunityChannels,
	getCustomerCommunityFeed,
	getCustomerCommunityMe,
	getCustomerCommunityMeetups,
	getCustomerCommunityMeetupsId,
	getCustomerCommunityPostsId,
	getCustomerCommunityPostsIdComments,
	getCustomerLivesIdChat,
	postCustomerCommunityCommentsIdReport,
	postCustomerCommunityMeetupsIdRsvp,
	postCustomerCommunityPostsIdComments,
	postCustomerCommunityPostsIdReactions,
	postCustomerCommunityPostsIdReport,
	postCustomerLivesIdChatMessages,
} from "../client/sdk.gen";
import { read, write } from "../tool-meta";
import { uiTool } from "../ui";

const CONFIRM = " ⚠️ Irreversible: confirm with the human before running it.";
const CRED =
	" Needs an enterprise service API key plus the buyer session the " +
	"connection carries (X-Customer-Session; never a tool argument).";
const RETRY =
	" 503 `SESSION_UNAVAILABLE` and 429 `RATE_LIMITED` carry `Retry-After`.";
const INTERACT =
	" 403 `BANNED` for a buyer expelled from the community; 403 " +
	"`MEMBERSHIP_REQUIRED` on a members-only or member post without a " +
	"current membership.";

const postId = z
	.string()
	.min(1)
	.describe("Post id (or the slug of an ARTICLE)");
const reportFields = {
	reason: z.enum(["SPAM", "HARASSMENT", "HATE", "SEXUAL", "OTHER"]),
	detail: z.string().max(500).optional().describe("Optional context"),
};

/**
 * The buyer's view of a brand's community (/api/v1/customer/community/* and
 * the live chat, contract 1.47–1.55): feed, posts, comments, meetups and
 * chat, as ONE buyer of the enterprise key's organization.
 *
 * Double credential by contract — enterprise key AND buyer session — so it
 * rides the B2B client (the key) and adds `X-Customer-Session` per call. Only
 * registered when the connection carries both (see server.ts), like
 * `merch_orders_lookup`. Without the session the reads would answer the
 * redacted teaser, which the organizer already sees in full through the
 * content_* tools.
 *
 * Left out on purpose (see coverage.test.ts): `POST /customer/lives/{id}/chat/token`
 * mints a browser Realtime JWT.
 */
export function registerCustomerCommunityTools(
	server: McpServer,
	client: Client,
	customerSession: string,
): void {
	const headers = { "X-Customer-Session": customerSession };

	server.tool(
		"customer_community_me",
		"The session buyer's state in the key's community: membership, whether " +
			"they can interact (false when banned) and the other flags " +
			`(GET /customer/community/me).${CRED}`,
		{},
		read("customer_community_me"),
		async () => run(getCustomerCommunityMe({ headers, client })),
	);
	uiTool(
		server,
		"customer_community_channels",
		"Active channels of the key's community, Announcements first and then " +
			"the buyer's city (GET /customer/community/channels). Pass a `slug` " +
			"as `channel` to `customer_community_feed`. Empty when the " +
			`organization has not opened its community.${CRED}`,
		{},
		async () => run(getCustomerCommunityChannels({ headers, client })),
	);
	uiTool(
		server,
		"customer_community_feed",
		"Community feed as the session buyer sees it, newest first " +
			"(GET /customer/community/feed). Members also get approved member " +
			"posts; members-only posts come redacted (`locked: true`) to " +
			"non-members. The pinned post comes first on the first page, on top " +
			"of `limit`. Pass `page.nextCursor` back as `cursor`." +
			CRED +
			RETRY,
		{
			channel: z
				.string()
				.optional()
				.describe("Channel slug from customer_community_channels"),
			limit: z.number().int().min(1).max(50).optional().describe("1-50"),
			cursor: z.string().optional().describe("Opaque `page.nextCursor`"),
		},
		async (q) => run(getCustomerCommunityFeed({ query: q, headers, client })),
	);
	server.tool(
		"customer_community_post_get",
		"Permalink of one community post, with `body` (Markdown) unless it is " +
			"`locked` for the buyer (GET /customer/community/posts/{id}). 404 for " +
			`drafts, posts pending review, deleted or of another organization.${CRED}`,
		{ id: postId },
		read("customer_community_post_get"),
		async ({ id }) =>
			run(getCustomerCommunityPostsId({ path: { id }, headers, client })),
	);
	uiTool(
		server,
		"customer_community_comments",
		"Visible comments of a post, oldest first, with `parentId` for replies " +
			"(one level; a parent always comes before its replies) " +
			"(GET /customer/community/posts/{id}/comments). Authors by public " +
			"alias only. 403 `MEMBERSHIP_REQUIRED` when the post is locked for " +
			`the buyer.${CRED}`,
		{
			id: postId,
			limit: z.number().int().min(1).max(50).optional().describe("1-50"),
			cursor: z.string().optional().describe("Opaque `page.nextCursor`"),
		},
		async ({ id, ...q }) =>
			run(
				getCustomerCommunityPostsIdComments({
					path: { id },
					query: q,
					headers,
					client,
				}),
			),
	);
	uiTool(
		server,
		"customer_community_meetups",
		"Upcoming and in-progress PUBLISHED meetups of the community, soonest " +
			"first (GET /customer/community/meetups). Without a current " +
			"membership each one is a teaser (`locked: true`); `locationDetail` " +
			`and \`onlineUrl\` only come to a member whose RSVP is GOING.${CRED}`,
		{ limit: z.number().int().min(1).max(50).optional().describe("1-50") },
		async (q) =>
			run(getCustomerCommunityMeetups({ query: q, headers, client })),
	);
	server.tool(
		"customer_community_meetups_get",
		"One community meetup with the buyer's `myRsvp` " +
			"(GET /customer/community/meetups/{id}). Cancelled and past ones " +
			`still resolve; drafts answer 404.${CRED}`,
		{ id: z.string().describe("Meetup id") },
		read("customer_community_meetups_get"),
		async ({ id }) =>
			run(getCustomerCommunityMeetupsId({ path: { id }, headers, client })),
	);
	server.tool(
		"customer_live_chat",
		"Latest chat messages of a live stream, oldest first " +
			"(GET /customer/lives/{id}/chat). Readable by whoever can watch the " +
			"live: a current member, the creator or, for a live tied to a show " +
			"date, a CONFIRMED ticket holder for that date (403 " +
			`\`MEMBERSHIP_REQUIRED\` otherwise).${CRED}`,
		{
			id: z.string().describe("Live stream id"),
			limit: z.number().int().min(1).max(200).optional().describe("1-200"),
		},
		read("customer_live_chat"),
		async ({ id, ...q }) =>
			run(getCustomerLivesIdChat({ path: { id }, query: q, headers, client })),
	);

	// ── Writes (as the buyer; the organization comes from the key) ───────────
	server.tool(
		"customer_community_comments_create",
		"Comments on a community post as the session buyer, or replies to a " +
			"visible top-level comment of the SAME post with `parentId` " +
			"(POST /customer/community/posts/{id}/comments). 404 " +
			"`PARENT_NOT_FOUND`, 422 `INVALID_PARENT` (a reply to a reply). At " +
			`most 8 comments per minute.${INTERACT}${CRED}`,
		{
			id: postId,
			body: z.string().min(1).max(2000).describe("Comment text"),
			parentId: z
				.string()
				.min(1)
				.max(100)
				.regex(/^[A-Za-z0-9_-]+$/)
				.optional()
				.describe("Top-level comment to reply to"),
		},
		write("customer_community_comments_create", { destructive: false }),
		async ({ id, ...body }) =>
			run(
				postCustomerCommunityPostsIdComments({
					path: { id },
					body,
					headers,
					client,
				}),
			),
	);
	server.tool(
		"customer_community_comments_delete",
		"Deletes one of the buyer's own comments; a top-level comment takes its " +
			"replies with it (`deletedIds`) (DELETE /customer/community/comments/{id}). " +
			"404 for someone else's comment; 409 `UNDER_REVIEW` while it has open " +
			`reports.${CRED}${CONFIRM}`,
		{ id: z.string().describe("Comment id") },
		write("customer_community_comments_delete", { destructive: true }),
		async ({ id }) =>
			run(deleteCustomerCommunityCommentsId({ path: { id }, headers, client })),
	);
	server.tool(
		"customer_community_react",
		"Puts the buyer's reaction on a post " +
			"(POST /customer/community/posts/{id}/reactions). Idempotent: one " +
			"reaction per buyer and post; the count is never returned." +
			INTERACT +
			CRED,
		{ id: postId },
		write("customer_community_react", { destructive: false, idempotent: true }),
		async ({ id }) =>
			run(
				postCustomerCommunityPostsIdReactions({
					path: { id },
					headers,
					client,
				}),
			),
	);
	server.tool(
		"customer_community_unreact",
		"Removes the buyer's reaction from a post " +
			"(DELETE /customer/community/posts/{id}/reactions). Idempotent, and " +
			`always allowed, also for a banned buyer or an expired membership.${CRED}`,
		{ id: postId },
		write("customer_community_unreact", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id }) =>
			run(
				deleteCustomerCommunityPostsIdReactions({
					path: { id },
					headers,
					client,
				}),
			),
	);
	const REPORT_NOTE =
		" Idempotent per target and buyer (`duplicate: true`); 409 `OWN_CONTENT` " +
		"for the buyer's own. At most 20 reports per hour.";
	server.tool(
		"customer_community_posts_report",
		"Reports another member's post to the community's moderation queue " +
			"(POST /customer/community/posts/{id}/report). Only member posts: an " +
			"organization post answers 404." +
			REPORT_NOTE +
			INTERACT +
			CRED,
		{ id: postId, ...reportFields },
		write("customer_community_posts_report", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id, ...body }) =>
			run(
				postCustomerCommunityPostsIdReport({
					path: { id },
					body,
					headers,
					client,
				}),
			),
	);
	server.tool(
		"customer_community_comments_report",
		"Reports a comment to the community's moderation queue " +
			"(POST /customer/community/comments/{id}/report)." +
			REPORT_NOTE +
			INTERACT +
			CRED,
		{ id: z.string().describe("Comment id"), ...reportFields },
		write("customer_community_comments_report", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id, ...body }) =>
			run(
				postCustomerCommunityCommentsIdReport({
					path: { id },
					body,
					headers,
					client,
				}),
			),
	);
	server.tool(
		"customer_community_rsvp",
		"Confirms the buyer's attendance to a meetup and returns it updated " +
			"(POST /customer/community/meetups/{id}/rsvp): `myRsvp` is GOING, or " +
			"PENDING when the meetup needs approval. Requires a current " +
			"membership. 409 `MEETUP_FULL`, `MEETUP_CLOSED`, `RSVP_DECLINED`. " +
			`Idempotent: repeating it takes no extra seat.${CRED}`,
		{ id: z.string().describe("Meetup id") },
		write("customer_community_rsvp", { destructive: false, idempotent: true }),
		async ({ id }) =>
			run(
				postCustomerCommunityMeetupsIdRsvp({ path: { id }, headers, client }),
			),
	);
	server.tool(
		"customer_community_rsvp_cancel",
		"Cancels the buyer's attendance (frees the seat) or withdraws a pending " +
			"request, and returns the meetup (DELETE /customer/community/meetups/{id}/rsvp). " +
			"Never needs a membership. 409 `MEETUP_CLOSED` once it started. " +
			`Idempotent.${CRED}`,
		{ id: z.string().describe("Meetup id") },
		write("customer_community_rsvp_cancel", {
			destructive: false,
			idempotent: true,
		}),
		async ({ id }) =>
			run(
				deleteCustomerCommunityMeetupsIdRsvp({ path: { id }, headers, client }),
			),
	);
	server.tool(
		"customer_live_chat_send",
		"Posts a message in a live stream's chat as the session buyer " +
			"(POST /customer/lives/{id}/chat/messages); every viewer receives it. " +
			"Collapsed to one line, 1-280 characters (422 `EMPTY` / `TOO_LONG`). " +
			"409 `LIVE_NOT_ACTIVE` when the live is not on air, 403 `BANNED`, 403 " +
			"`MEMBERSHIP_REQUIRED`; 502 `SEND_FAILED` stores nothing. One message " +
			"per second. To retry a failed send without duplicating it, pass the " +
			`same \`idempotencyKey\` and text; a new message needs a new key.${CRED}`,
		{
			id: z.string().describe("Live stream id"),
			text: z.string().min(1).max(280).describe("Message text"),
			idempotencyKey: z
				.string()
				.min(1)
				.max(255)
				.optional()
				.describe("Omit for a new message (one is generated)"),
		},
		write("customer_live_chat_send", { destructive: false }),
		async ({ id, text, idempotencyKey }) =>
			run(
				postCustomerLivesIdChatMessages({
					path: { id },
					body: { text },
					headers: {
						...headers,
						"Idempotency-Key": idempotencyKey ?? randomUUID(),
					},
					client,
				}),
			),
	);
}
