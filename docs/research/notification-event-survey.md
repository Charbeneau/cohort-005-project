# Candidate Notification events in Cadence

**Surveys:** local `main` @ `979e285` (plus its uncommitted working-tree `GLOSSARY.md` and untracked ADRs 0001–0004). **Supersedes** the earlier version of this file, which surveyed the stale `origin/main` @ `b741ddd`.

Question (issue #3, child of map #2): which events in Cadence's current code concern a person enough to be a candidate in-app **Notification** ("a message Cadence shows a person inside the app about something that happened that concerns them" — `GLOSSARY.md`, Notifications)? For each: where it happens, who it concerns, and whether an email is already sent. This is a survey only; it does not pick a v1 catalogue.

Roles use `GLOSSARY.md` terms: **Student**, **Instructor**, **Platform Admin**, **Team Admin**. In code, Platform Admin is `UserRole.Admin` (`app/db/schema.ts:11-15`); Team Admin is `TeamMemberRole.Admin` (`app/db/schema.ts:40-43`).

## Email today

`app/lib/mailer.server.ts:67` `sendEmail()` sends through Postmark when `POSTMARK_SERVER_TOKEN` is set, otherwise writes JSON to `.outbox/` (`mailer.server.ts:4-6, 61-64`). It has exactly **two callers** (grep of `app/` excluding tests):

| Caller | Email built at | Event |
| --- | --- | --- |
| `app/routes/courses.$slug.refund.ts:75` | `app/lib/refunds.server.ts:394-406` (`raiseRefundRequest`) | Refund Request raised — "Refund requested — {course}" to the buyer |
| `app/routes/admin.refunds.tsx:130` | `app/lib/refunds.server.ts:736-780` (`buildDecisionEmail`) | Refund Request approved or declined — "Refund approved/declined — {course}" to the buyer |

`app/routes/courses.$slug.purchase.tsx:148,173` has a `sendEmail` **boolean parameter**, not a call: `enrollUser` contains only the comment `// Would send welcome email here` (line 174), and its sole caller passes `false` (line 371). No welcome email is sent.

Every email goes to the buyer of a Purchase. Nothing emails an Instructor, a Platform Admin, or a Student who holds a Claimed Seat.

## Candidates with a trigger in code

### Student (incl. the buyer of an Individual Purchase)

| Event | Where | Concerns | Email today? |
| --- | --- | --- | --- |
| Individual Purchase made, Enrollment granted | `courses.$slug.purchase.tsx:370-371` (`createPurchase`, `enrollUser`) | Buyer (Student); also the course's Instructor | No (stub at :173-175, called with `false`) |
| Seat claimed → Enrollment | `redeem.$code.tsx:98-110` (`redeemCoupon`) | Claiming Student; also the Team Admin who bought the Licence | No |
| Open Refund Request raised (Individual Purchase) | `refunds.server.ts:357-407` (`raiseRefundRequest`, insert :379-388), route `courses.$slug.refund.ts:63-75` | Buyer (Student); Platform Admins (a new request to decide) | **Yes**, buyer only |
| Refund Request approved → Enrollment ends (Lapsed) | `refunds.server.ts:614-688` (`approveRefundRequest`; Enrollment delete :658-665; status :669-679), route `admin.refunds.tsx:111` | Buyer (Student) | **Yes** (`admin.refunds.tsx:130`) |
| Refund Request declined, with note | `refunds.server.ts:692-733` (`declineRefundRequest`; status :713-722), route `admin.refunds.tsx:118` | Buyer (Student) | **Yes** (`admin.refunds.tsx:130`) |
| Reply posted to a Student's comment/question | `courses.$slug.lessons.$lessonId.tsx:404-435` (`createComment` with `parentId`), action :903; staff answers via `instructor.questions.tsx:118-156`, action :211 | Author of the parent comment (Student) | No |
| Comment deleted by staff | `courses.$slug.lessons.$lessonId.tsx:459-479` (`deleteComment`, `isStaff` path), action :935 | Comment author | No |
| Platform Admin edits a user's name/email | `admin.users.tsx:46-57`, action :122 | That user | No |
| Platform Admin changes a user's role | `admin.users.tsx:60-67`, action :128 | That user (becomes Student/Instructor/Platform Admin) | No |
| Course status changed (draft/published/archived) | `instructor.$courseId.tsx:154-161`, action :696; `admin.courses.tsx:76-83`, action :142 | Enrolled Students; the Instructor when a Platform Admin changes it | No |

Self-inflicted Student actions with a code trigger but weaker "concerns them" value: lesson marked complete (`courses.$slug.lessons.$lessonId.tsx:218-243`, action :947), quiz submitted/passed (insert :602-611, `passed = score > 0.7` at :599, action :952), course rated (`courses.$slug.tsx:330-362`, action :478). None email.

### Instructor

| Event | Where | Email today? |
| --- | --- | --- |
| New Enrollment on their course (Individual Purchase or Claimed Seat) | `courses.$slug.purchase.tsx:371`; `redeem.$code.tsx:106-110` | No |
| Team Licence bought for their course | `courses.$slug.purchase.tsx:378` (`createTeamPurchase` :245-256) | No |
| Student question posted on a lesson (feeds the unanswered queue) | `courses.$slug.lessons.$lessonId.tsx:404-435`, action :903; queue `instructor.questions.tsx:42-60` | No |
| Rating left on their course | `courses.$slug.tsx:330-362` | No |
| Platform Admin changes their course's status | `admin.courses.tsx:142` | No |
| Refund Request approved on their course (Student Lapsed / revenue lost) | `refunds.server.ts:614` | No |

### Platform Admin

| Event | Where | Email today? |
| --- | --- | --- |
| New Open Refund Request awaiting decision | `refunds.server.ts:379-388` | No (only the buyer is emailed) |
| (Implied) Open request has since crossed the Watch Limit / completion limit, so can only be declined | rules `refund-rules.ts:5-14`, rechecked at decision via `listRefundRequestsForReview` `refunds.server.ts:463-507` | No; and no event fires — it is computed on read |

### Team Admin

| Event | Where | Email today? |
| --- | --- | --- |
| Team Licence bought, Seats created | `courses.$slug.purchase.tsx:376-379`, `generateCoupons` :222-243 | No |
| A Seat on their Team Licence was claimed | `redeem.$code.tsx:98-104` | No |
| Open Refund Request raised on a Team Licence (Unclaimed Seats frozen) | `refunds.server.ts:357-407`; freeze via `getSeatAvailability` :111-120, enforced `redeem.$code.tsx:61-67` | **Yes** (same "Refund requested" email; route redirects to `/team`, `courses.$slug.refund.ts:77`) |
| Team Licence Refund Request approved (Unclaimed Seats can never be claimed) | `refunds.server.ts:638-643` (sets `coupons.refundedAt`) | **Yes** (decision email) |
| Team Licence Refund Request declined (Seats usable again) | `refunds.server.ts:692-733` | **Yes** (decision email) |
| Approval refused because a Seat is claimed | `refunds.server.ts:629-635` (409) | No — error shown only to the Platform Admin; the request stays Open |

Students holding an Unclaimed Seat's code are affected by freeze/void (ADR `0004-team-licence-seats-frozen-then-voided.md`, Consequences: "a team member holding a valid-looking code will find it stops working"), but they have no account link until they claim, so they cannot be notified in-app; they only see `SEAT_ON_HOLD` / `SEAT_REFUNDED` at `redeem.$code.tsx:62-67`.

## Events implied by the glossary/ADRs

| Implied event | Source | Trigger in code? |
| --- | --- | --- |
| Open Refund Request | GLOSSARY "Open Refund Request"; `RefundStatus.Open` `schema.ts:34-38` | **Yes** — `refunds.server.ts:379-388` |
| Approved Refund Request | GLOSSARY; ADR `0002-an-enrollment-ends-at-approval.md`, untracked `0001-access-ends-at-approval.md` | **Yes** — `refunds.server.ts:669-679` |
| Declined Refund Request | GLOSSARY | **Yes** — `refunds.server.ts:713-722` |
| Pending Refund | GLOSSARY "Pending Refund" | **No.** `RefundStatus` has only open/approved/declined (`schema.ts:34-38`). Approval sets `amountRefunded` (:672) but no payout state exists; the approval email already claims the money "is on its way back" (:760). |
| Issued Refund | GLOSSARY "Issued Refund"; untracked ADR 0001 calls payout "out of scope" | **No** — no column, status, or code path. |
| Failed Refund | GLOSSARY "Failed Refund"; ADR `0002-an-enrollment-ends-at-approval.md` | **No.** |
| Unclaimed Seats frozen while a request is Open | GLOSSARY "Open Refund Request"; ADRs `0003-team-licence-refunds-are-all-or-nothing.md`, `0004-team-licence-seats-frozen-then-voided.md` | Implicit only — derived on read (`getSeatAvailability`), no write of its own; coincides with the request being raised. |
| Unclaimed Seats voided on approval | ADR 0004 (untracked) | **Yes** — `coupons.refundedAt` set at `refunds.server.ts:638-643`. Untracked migration `drizzle/0011_flowery_marvel_zombies.sql` adds `coupons.voided_at`, but `schema.ts` has no `voidedAt` and no code uses it. |
| Student becomes Lapsed | GLOSSARY "Lapsed" | **Yes**, as a side effect of approval (`refunds.server.ts:658-665`); skipped if the Student also holds a Claimed Seat on that course (:645-656, ADR `0004-an-enrollment-is-not-tied-to-a-purchase.md`). |
| Watch Limit reached (no longer refundable) | GLOSSARY "Watch Limit"; untracked ADR `0003-usage-limit-rechecked-at-decision-refund-window-not.md` ("the course page warns a learner with an open request") | **No event** — computed on read from `videoWatchEvents` (recorded at `api.video-tracking.ts:30`). |
| Refund window closing (14 days) | `refund-rules.ts:5`, `lastDayOfWindow` `refunds.server.ts:52` | **No** — time-based, and no scheduler exists. |

## Notes

- The only Notification-like infrastructure today is the email transport; there is no notifications table (`schema.ts` tables :47-363).
- All three existing emails are built inside `refunds.server.ts` and returned to the route, so the refund lifecycle already has single, well-defined emission points to hang a Notification on.
- Several ADRs exist in two variants (committed vs. untracked working tree). Committed: `0001-approving-a-refund-request-keeps-progress`, `0002-an-enrollment-ends-at-approval`, `0003-team-licence-refunds-are-all-or-nothing`, `0004-an-enrollment-is-not-tied-to-a-purchase`. Untracked: `0001-access-ends-at-approval`, `0002-refunds-keep-progress-and-usage-spans-purchases`, `0003-usage-limit-rechecked-at-decision-refund-window-not`, `0004-team-licence-seats-frozen-then-voided`. They agree on the events above.
