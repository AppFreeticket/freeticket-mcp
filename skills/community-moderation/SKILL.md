---
name: community-moderation
description: Work through a FreeTicket community's moderation with the FreeTicket MCP tools — reported comments, member posts awaiting review, bans and meetup RSVP requests. Use when the user asks to moderate the community, review reports or pending member posts, ban or unban a member, or approve meetup requests.
---

# Community moderation

One workspace at a time. Every tool here needs Content in the plan and the
community enabled: a 403 `FEATURE_LOCKED` or `COMMUNITY_UNAVAILABLE` ends the
session — say so, do not retry. Read first, propose, and act only on what the
human approves item by item.

1. **Reported comments.** `content_moderation_queue` (50 per 0-based `page`,
   most reported first). For each, propose the lightest action that works:
   - `content_comments_ignore_reports` — the comment is fine; it stays and
     will no longer be auto-hidden.
   - `content_comments_hide` — reversible with `content_comments_unhide`.
   - `content_comments_delete` — irreversible, takes its replies with it.
   - `content_members_ban` — irreversible in its effects (needs ADMIN): pass
     the member's `author.customerId` as `id` and the reported comment as
     `commentId`; it cancels their upcoming meetup RSVPs. Use
     `hideAllComments` only if the human asks.
2. **Member posts.** `content_member_posts_list` (default `PENDING_REVIEW`).
   `content_member_posts_approve` needs the post's `updatedAt` exactly as
   read; on 409 `EDITED_SINCE_READ` re-read and review again.
   `content_member_posts_reject` (pending) and `content_member_posts_remove`
   (published, `status: "PUBLISHED"`) are irreversible and notify the author;
   a `reason` is shown to them, so write it for the member, in Spanish.
3. **Bans.** `content_moderation_bans` lists them; `content_members_unban`
   lifts one, but hidden comments and cancelled RSVPs stay that way.
4. **Meetup requests.** `content_meetups_list` for pending-request counts,
   `content_meetups_get` for the requests (it has names and emails — do not
   paste them whole). `content_meetups_rsvp_review` emails the member the
   decision; 409 `EVENT_FULL` means raise the capacity with
   `content_meetups_update` first, if the human wants.

Close with what was done and what is still pending, with counts.
