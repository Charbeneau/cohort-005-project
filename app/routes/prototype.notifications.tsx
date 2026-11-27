// PROTOTYPE — throwaway. Answers "What does the Notification Feed look like in
// Cadence?" (Charbeneau/cohort-005-project#24). Lives on the
// prototype/notification-feed branch only.
//
// - action: seeds the 7 catalogue Notifications into the current user's real
//   Knock feed, all through one stand-in workflow (`prototype-feed`); the
//   Notification kind rides in data.kind and Cadence renders the row itself.
// - page: the full-page Notification Feed used by variant C.
import { useSearchParams } from "react-router";
import type { Route } from "./+types/prototype.notifications";
import { requireUserId } from "~/lib/access.server";
import { knock, knockUserId } from "~/lib/knock-prototype.server";
import { db } from "~/db";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
import { FeedPage } from "~/components/notification-feed-prototype";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserId(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const me = db.select().from(users).where(eq(users.id, userId)).get()!;
  const others = db.select().from(users).where(ne(users.id, userId)).all();
  const pick = (i: number) => others[i % others.length];

  const q = db
    .select({
      id: comments.id,
      body: comments.body,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      slug: courses.slug,
    })
    .from(comments)
    .innerJoin(lessons, eq(lessons.id, comments.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(and(isNull(comments.parentId), isNull(comments.deletedAt)))
    .get();
  const c = db.select().from(courses).get()!;
  const lessonUrl = q ? `/courses/${q.slug}/lessons/${q.lessonId}` : `/courses/${c.slug}`;
  const excerpt = (q?.body ?? "How do I set up the project?").slice(0, 90);
  const lessonTitle = q?.lessonTitle ?? "Getting started";

  // Oldest first, so the feed (newest first) reads in a sensible order.
  const seeds = [
    {
      kind: "new-enrollment",
      actor: pick(0),
      data: { courseTitle: c.title, url: `/instructor/${c.id}/students` },
    },
    {
      kind: "claimed-seat",
      actor: pick(1),
      data: { courseTitle: c.title, url: `/team` },
    },
    {
      kind: "refund-request-declined",
      actor: pick(2),
      data: {
        courseTitle: c.title,
        note: "Over 30 days since purchase and 80% of lessons completed.",
        url: `/courses/${c.slug}`,
      },
    },
    {
      kind: "open-refund-request",
      actor: pick(3),
      data: { courseTitle: c.title, reason: "Not what I expected", url: `/admin/refunds` },
    },
    {
      kind: "discussion-question",
      actor: pick(4),
      data: { courseTitle: c.title, lessonTitle, excerpt, url: lessonUrl },
    },
    {
      kind: "refund-request-approved",
      actor: pick(5),
      data: { courseTitle: c.title, amount: "$49.00", url: `/courses/${c.slug}` },
    },
    {
      kind: "discussion-reply",
      actor: pick(6),
      data: { courseTitle: c.title, lessonTitle, excerpt, url: lessonUrl },
    },
  ];

  for (const s of seeds) {
    await knock.workflows.trigger("prototype-feed", {
      recipients: [{ id: knockUserId(me.id), name: me.name, email: me.email }],
      actor: { id: knockUserId(s.actor.id), name: s.actor.name, email: s.actor.email },
      data: {
        kind: s.kind,
        actorName: s.actor.name,
        actorAvatarUrl: s.actor.avatarUrl,
        text: `${s.kind} from ${s.actor.name}`,
        ...s.data,
      },
    });
    // Spread inserted_at a little so ordering is stable.
    await new Promise((r) => setTimeout(r, 250));
  }
  return { seeded: seeds.length, recipient: me.name };
}

export default function PrototypeNotificationsPage() {
  const [params] = useSearchParams();
  return <FeedPage filter={params.get("kind")} />;
}
