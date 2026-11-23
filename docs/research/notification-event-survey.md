# Survey: candidate Notification events in Cadence

Research for issue #3 (child of map #2, "Wayfinder: In-app Notifications").
Question: which events in Cadence's current code concern a person enough to be
a candidate in-app Notification? Survey only; this does not pick a v1 catalogue.

Source: the code on `main` at `b741ddd`. Every `file:line` below refers to that commit.

## Premise check: three files the map names are missing

The map (#2) and the ticket point at sources that are **not in the repo** at `b741ddd`:

| Referenced | Status |
| --- | --- |
| `GLOSSARY.md` | Absent. The only glossary file is `.agents/skills/teach/GLOSSARY-FORMAT.md`, a format template. |
| `app/lib/mailer.server.ts` (Postmark + `.outbox/` fallback) | Absent. Nothing in `app/` mentions Postmark, `sendEmail()` or `.outbox`. |
| `docs/adr/` | Absent. `docs/` holds only `docs/agents/issue-tracker.md`. |

Consequences:

- **No email is sent today for any event.** There is no mail transport. Two places
  come close:
  - `app/routes/courses.$slug.refund.ts:88-112, 225-234`: `buildReversalEmail()`
    builds a confirmation and **`console.log`s it** ("There is no mail transport wired
    up yet, so the built message goes to the server log", lines 89-90).
  - `app/routes/courses.$slug.purchase.tsx:173-175`: `if (sendEmail) { // Would send welcome email here }`
    is an empty stub, and its only caller passes `sendEmail = false` (line 371).
  - The map's standing requirement to "mirror the mailer's `.outbox/` fallback" and its
    note that "existing Postmark emails stay as they are" have nothing in the code to refer to.
- **Role terms come from the code, not a glossary.**
  - `UserRole` (`app/db/schema.ts:11-15`) is `student | instructor | admin`. Here
    *Platform Admin* = `UserRole.Admin`.
  - `TeamMemberRole` (`schema.ts:40-43`) is `admin | member`. Here *Team Admin* =
    `team_members.role = admin`. That row is created for the buyer of a team purchase
    (`courses.$slug.purchase.tsx:210-219`).
  - A Seat is a `coupons` row (`schema.ts:277-294`), claimed at `/redeem/:code`.
- **The code uses several words for one thing.** The `refunds` table is called a "refund"
  in the schema, a "Reversal" in the email copy (`refund.ts:100-107`), a
  "chargeback" on `/settings` (`settings.tsx:58`, `pendingChargebacks`), and a
  "cancel" in the UI and error copy (`refund.ts:33, 118`). The map uses "Refund Request".

## Candidates by role

"Email today" is **No** for every row because no transport exists. Rows marked
*logged* build an email body and print it to the server log only.

"Strength" is a rough survey note, not a catalogue decision:

- **strong**: someone else causes the event, and the person would otherwise not know about it.
- **weak**: the person causes it themselves and sees the result at once, or it is low-signal.
- **missing**: the code that would fire the event does not exist yet.

### Student

| # | Event | Where (file:line) | Email today | Strength |
| --- | --- | --- | --- | --- |
| S1 | Someone replies to the Student's lesson comment/question (another Student, or staff answering) | `courses.$slug.lessons.$lessonId.tsx:903` → `createComment` `:404-436` (insert `:431`, `parentId` set); staff answer from the queue at `instructor.questions.tsx:211` → insert `:153` | No | strong |
| S2 | Staff (Instructor/Platform Admin) delete the Student's comment | `courses.$slug.lessons.$lessonId.tsx:935` → `deleteComment` `:459-476` (`isStaff` path `:464`) | No | strong |
| S3 | Refund Request submitted (confirmation) | `courses.$slug.refund.ts:215-223` (insert), email `:225-234` | *Logged* (console only) | medium |
| S4 | Refund Request approved / declined | **No code path.** Schema has `RefundStatus.Approved/Declined`, `resolvedAt` and `resolvedByUserId` (`schema.ts:34-38, 239-251`). Nothing writes them. The email copy promises "we will email you again when it is done" (`refund.ts:107`) | No (missing) | strong but **missing** |
| S5 | Enrolled after an individual purchase | `courses.$slug.purchase.tsx:370-371` → `enrollUser` `:145-178` (welcome-email stub `:173-175`) | No (stub, `sendEmail=false`) | weak (self-initiated, redirects to `/welcome`) |
| S6 | Enrolled by claiming a team Seat | `redeem.$code.tsx:179` → `redeemCoupon` `:84-96` | No | weak |
| S7 | Course they're enrolled in is archived/unpublished | Instructor: `instructor.$courseId.tsx:695-697` → `:154-161`. Platform Admin: `admin.courses.tsx:141-143` → `:76-83` | No | medium |
| S8 | New lesson/module added to a course they're enrolled in | `instructor.$courseId.tsx:753` (add-lesson → insert `:282`), `:722` (add-module → insert `:221`) | No | medium (fires once per lesson as the Instructor builds the course) |
| S9 | Quiz deleted/replaced, which **wipes their attempts** | `instructor.$courseId.lessons.$lessonId.quiz.tsx:201-219` (deletes `quizAttempts` `:217`), called at `:402` and `:428` | No | medium (Student loses data silently) |
| S10 | Quiz result | `courses.$slug.lessons.$lessonId.tsx:970` → `computeResult` (insert `:602-611`) | No | weak (synchronous, self) |
| S11 | Lesson marked complete / course completed | `courses.$slug.lessons.$lessonId.tsx:948` → `:218-243`. `enrollments.completedAt` (`schema.ts:134`) is **never written** anywhere | No | weak; course-complete is **missing** |

### Instructor

| # | Event | Where (file:line) | Email today | Strength |
| --- | --- | --- | --- | --- |
| I1 | New question (top-level comment) on a lesson in their course | `courses.$slug.lessons.$lessonId.tsx:903` → insert `:431` with `parentId = null`. Shown in the `/instructor/questions` queue (`instructor.questions.tsx`) | No | strong |
| I2 | Follow-up reply in a thread on their course | same site, `parentId` set | No | medium |
| I3 | Question unanswered for 3+ days | No event. Only a render-time flag: `STALE_AFTER_DAYS = 3` (`instructor.questions.tsx`, near `:159`). Would need a scheduler | No | medium, **no trigger exists** |
| I4 | New enrollment / purchase in their course | `courses.$slug.purchase.tsx:370-371`; Seat claim `redeem.$code.tsx:92-96` | No | medium |
| I5 | Team purchase of their course (N Seats) | `courses.$slug.purchase.tsx:378` → `createTeamPurchase` `:245-256` | No | medium |
| I6 | Refund Request filed on their course | `courses.$slug.refund.ts:215-223` | No | medium |
| I7 | New or changed course rating | `courses.$slug.tsx:613` → `rateCourse` `:335-368` | No | weak-medium |
| I8 | Platform Admin changes their course's status | `admin.courses.tsx:141-143` | No | strong |
| I9 | Their role is changed by a Platform Admin (e.g. promoted to Instructor) | `admin.users.tsx:126-129` → `:60-67` | No | medium (applies to any role) |

### Platform Admin

| # | Event | Where (file:line) | Email today | Strength |
| --- | --- | --- | --- | --- |
| P1 | Refund Request awaiting manual review ("Our team reviews every Reversal by hand", `refund.ts:107`) | `courses.$slug.refund.ts:215-223`. **No admin review UI or action exists** to act on it | No | strong, but there's nothing to act from yet |
| P2 | Instructor publishes a course | `instructor.$courseId.tsx:695-697` | No | weak-medium |
| P3 | Instructor creates a new course | `instructor.new.tsx:60` | No | weak |
| P4 | New user signs up | `signup.tsx:78-82` | No | weak |
| P5 | New question anywhere (admins see every course's queue) | same as I1; admin scope at `instructor.questions.tsx` loader (`isAdmin ? null : userId`) | No | weak (overlaps with I1) |

### Team Admin

| # | Event | Where (file:line) | Email today | Strength |
| --- | --- | --- | --- | --- |
| T1 | A Seat is claimed by a team member | `redeem.$code.tsx:84-90` (sets `redeemedByUserId`/`redeemedAt`) | No | strong |
| T2 | All Seats on a purchase claimed | Derived from T1 (no separate code) | No | medium |
| T3 | Seat claim rejected because of a country mismatch | `redeem.$code.tsx:76-82` (returns error; nothing persisted) | No | weak (no state change) |
| T4 | Team purchase completed / Seats issued | `courses.$slug.purchase.tsx:378` → `:245-256`; team + Team Admin row created `:210-219` | No | weak (self-initiated, redirects to `/team`) |

### Applies to any role

| # | Event | Where | Email today | Strength |
| --- | --- | --- | --- | --- |
| A1 | Platform Admin edits a user's name/email | `admin.users.tsx:119-123` → `:46-58` | No | medium (an email change matters) |
| A2 | Role changed (see I9) | `admin.users.tsx:126-129` | No | medium |
| A3 | Signup welcome | `signup.tsx:78` | No | weak |

## Not candidates

These state changes concern only the actor, who sees the result at once:
video tracking (`api.video-tracking.ts:30`), own profile edit (`settings.tsx:116`),
own comment edit (`courses.$slug.lessons.$lessonId.tsx:452`), category CRUD
(`admin.categories.tsx`), and course authoring other than S7/S8 (title, description,
price, PPP and sales copy in `instructor.$courseId.tsx:685-716, 844`).

## Open points for later tickets

- The map's mailer/Postmark/`.outbox` assumptions and `GLOSSARY.md` should be checked
  with the map owner. They may live on another branch or fork, or be planned rather than built.
- Several of the strongest candidates (S4 refund resolved, P1 refund review, I3 stale
  question, S11 course completed) have **no trigger in the code**. A v1 catalogue that
  includes them also commits to building that trigger.
