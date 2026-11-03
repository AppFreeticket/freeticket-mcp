---
name: course-builder
description: Build or edit a FreeTicket course or downloadable product with the FreeTicket MCP tools — modules, lessons, quizzes, resources, drip and publication — without losing buyers' progress. Use when the user asks to create a course, add or reorder lessons or modules, edit a digital product, or publish/unpublish one.
---

# Course builder

One workspace at a time; writes need an ADMIN key (an event-scoped key gets
403). Nothing here uploads files: PDFs, samples and lesson videos must already
be uploaded in the dashboard. If the human has not done it, stop and say so —
do not invent a `filePath` or `videoId`.

1. **Find it.** `products_list`, then `products_get` for the one to work on.
   Keep that detail: its module, lesson and resource `id`s are what keeps
   buyers' progress.
2. **New product.** `products_create` with `publish: false` (DRAFT). A
   DOWNLOADABLE needs `fileName`/`filePath`; a COURSE needs `modules` with at
   least one lesson each. Lesson `content`: TEXT takes Markdown in `body`,
   VIDEO a `videoId`, FILE a `filePath`, QUIZ a `quiz` (`correctOptionId` is
   the `id` of one of that question's options). At most one `isPreview`
   lesson per module. COP prices are integers.
3. **Edit fields only.** `products_update` without `modules` (name, price,
   cover, `courseMeta`, `unlockMode`…). Safe.
4. **Edit the tree.** `products_update` with `modules` replaces the WHOLE
   tree: start from the `products_get` you just read, change only what was
   asked, keep every existing `id`, and send all modules back. Anything left
   out is deleted with its progress — show the human what disappears before
   sending. New lessons without `id` are created; on a published course with
   buyers they get notified. 409 `COURSE_CHANGED` → read again and redo.
5. **Publish.** `products_set_status` with `PUBLISHED` (or `DRAFT` to
   hide it); 403 `LIVE_LESSONS_PLAN_REQUIRED` means the plan lacks streaming.
   `products_delete` is irreversible — only on explicit request.

Close with the product id, status and the module/lesson count.
