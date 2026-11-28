// PROTOTYPE — throwaway. Answers "What does the Notification Feed look like in
// Cadence?" (Charbeneau/cohort-005-project#24). Lives on the
// prototype/notification-feed branch only.
//
// Three structurally different Notification Feeds, switchable with ?variant=
// (A/B/C) or the floating bar at the bottom. All three read the signed-in
// DevUI user's REAL Knock feed (public key + signed user token) and share one
// poller, so switching variants keeps read/seen state.
//
//   A  Bell popover   — bell in the sidebar header, badge = UNSEEN count.
//                       Opening marks everything seen; rows stay bold until read.
//   B  Side drawer    — "Notifications" in the nav, badge = UNREAD count (no
//                       seen concept). Full-height drawer, Unread/All tabs,
//                       per-row read toggle.
//   C  Full page      — "Notifications" nav item → /prototype/notifications.
//                       Category filters, archive, and a toast on arrival
//                       instead of a popup.
//   D  Combined       — the user's pick: A's bell and badge, B's rows, C's
//                       filters (as chips in the popover), badge = UNREAD.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NavLink, useFetcher, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  Archive,
  Bell,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  MessageSquare,
  Receipt,
  UsersRound,
  X,
} from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";

const KNOCK_API = "https://api.knock.app/v1";
const VARIANTS = ["A", "B", "C", "D"] as const;
type Variant = (typeof VARIANTS)[number];
const VARIANT_NAMES: Record<Variant, string> = {
  A: "Bell popover",
  B: "Side drawer",
  C: "Full page",
  D: "Combined pick",
};

export type FeedAuth = {
  knockUserId: string;
  userToken: string;
  publicApiKey: string;
  feedChannelId: string;
};

type FeedItem = {
  id: string;
  inserted_at: string;
  read_at: string | null;
  seen_at: string | null;
  archived_at: string | null;
  data: Record<string, string | null | undefined>;
};

type FeedMeta = { unread_count: number; unseen_count: number; total_count: number };

// ---------------------------------------------------------------------------
// Shared feed state (one poller for the whole app shell)
// ---------------------------------------------------------------------------

type FeedState = {
  items: FeedItem[];
  meta: FeedMeta | null;
  error: string | null;
  mark: (status: "read" | "unread" | "seen" | "archived", ids: string[]) => Promise<void>;
  refresh: () => void;
  variant: Variant;
  setVariant: (v: Variant) => void;
};

const FeedContext = createContext<FeedState | null>(null);

function useFeed() {
  const ctx = useContext(FeedContext);
  if (!ctx) throw new Error("PROTOTYPE: useFeed outside FeedPrototypeProvider");
  return ctx;
}

function useVariant(): [Variant, (v: Variant) => void] {
  const { variant, setVariant } = useFeed();
  return [variant, setVariant];
}

export function FeedPrototypeProvider({
  auth,
  children,
}: {
  auth: FeedAuth | null;
  children: ReactNode;
}) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ?variant= wins; otherwise remember the last one so ordinary sidebar
  // navigation (which drops the param) keeps the chosen variant.
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("variant") as Variant | null;
  const [variant, setVariantState] = useState<Variant>("A");
  useEffect(() => {
    const s = localStorage.getItem("proto-feed-variant") as Variant | null;
    if (s && VARIANTS.includes(s)) setVariantState(s);
  }, []);
  useEffect(() => {
    if (fromUrl && VARIANTS.includes(fromUrl)) {
      setVariantState(fromUrl);
      localStorage.setItem("proto-feed-variant", fromUrl);
    }
  }, [fromUrl]);
  const setVariant = (v: Variant) => {
    setVariantState(v);
    localStorage.setItem("proto-feed-variant", v);
    const next = new URLSearchParams(params);
    next.set("variant", v);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const headers = auth
    ? {
        Authorization: `Bearer ${auth.publicApiKey}`,
        "X-Knock-User-Token": auth.userToken,
        "Content-Type": "application/json",
      }
    : null;

  const refresh = useCallback(async () => {
    if (!auth || !headers) return;
    const res = await fetch(
      `${KNOCK_API}/users/${auth.knockUserId}/feeds/${auth.feedChannelId}?page_size=50`,
      { headers }
    );
    if (!res.ok) {
      setError(`feed ${res.status}`);
      return;
    }
    const json = await res.json();
    setError(null);
    setItems(json.entries);
    setMeta(json.meta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.knockUserId, auth?.userToken]);

  useEffect(() => {
    setItems([]);
    setMeta(null);
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const mark: FeedState["mark"] = async (status, ids) => {
    if (!headers || ids.length === 0) return;
    // Optimistic, so the UI reacts instantly.
    const now = new Date().toISOString();
    setItems((prev) =>
      status === "archived"
        ? prev.filter((i) => !ids.includes(i.id))
        : prev.map((i) =>
            !ids.includes(i.id)
              ? i
              : status === "read"
                ? { ...i, read_at: now, seen_at: i.seen_at ?? now }
                : status === "unread"
                  ? { ...i, read_at: null }
                  : { ...i, seen_at: i.seen_at ?? now }
          )
    );
    await fetch(`${KNOCK_API}/messages/batch/${status}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message_ids: ids }),
    });
    refresh();
  };

  return (
    <FeedContext.Provider value={{ items, meta, error, mark, refresh, variant, setVariant }}>
      {children}
    </FeedContext.Provider>
  );
}

// Counts from items (not meta) so optimistic updates show immediately.
function counts(items: FeedItem[]) {
  return {
    unread: items.filter((i) => !i.read_at).length,
    unseen: items.filter((i) => !i.seen_at).length,
  };
}

// ---------------------------------------------------------------------------
// How each catalogue Notification reads. Cadence owns this, not Knock.
// ---------------------------------------------------------------------------

type Category = "discussion" | "refunds" | "enrollments" | "team";

const KINDS: Record<
  string,
  {
    category: Category;
    icon: ReactNode;
    tone: string;
    line: (d: FeedItem["data"]) => ReactNode;
    detail?: (d: FeedItem["data"]) => string | null | undefined;
  }
> = {
  "discussion-reply": {
    category: "discussion",
    icon: <MessageSquare className="size-4" />,
    tone: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
    line: (d) => (
      <>
        <b>{d.actorName}</b> replied to your question in <b>{d.lessonTitle}</b>
      </>
    ),
    detail: (d) => d.excerpt && `“${d.excerpt}”`,
  },
  "discussion-question": {
    category: "discussion",
    icon: <MessageSquare className="size-4" />,
    tone: "text-blue-600 bg-blue-100 dark:bg-blue-900/30",
    line: (d) => (
      <>
        <b>{d.actorName}</b> asked a question in <b>{d.lessonTitle}</b>
      </>
    ),
    detail: (d) => d.excerpt && `“${d.excerpt}”`,
  },
  "new-enrollment": {
    category: "enrollments",
    icon: <GraduationCap className="size-4" />,
    tone: "text-violet-600 bg-violet-100 dark:bg-violet-900/30",
    line: (d) => (
      <>
        <b>{d.actorName}</b> enrolled in <b>{d.courseTitle}</b>
      </>
    ),
  },
  "claimed-seat": {
    category: "team",
    icon: <UsersRound className="size-4" />,
    tone: "text-amber-600 bg-amber-100 dark:bg-amber-900/30",
    line: (d) => (
      <>
        <b>{d.actorName}</b> claimed a seat for <b>{d.courseTitle}</b>
      </>
    ),
  },
  "refund-request-approved": {
    category: "refunds",
    icon: <Receipt className="size-4" />,
    tone: "text-green-600 bg-green-100 dark:bg-green-900/30",
    line: (d) => (
      <>
        Your Refund Request for <b>{d.courseTitle}</b> was approved
      </>
    ),
    detail: (d) => d.amount && `${d.amount} will be refunded`,
  },
  "refund-request-declined": {
    category: "refunds",
    icon: <Receipt className="size-4" />,
    tone: "text-red-600 bg-red-100 dark:bg-red-900/30",
    line: (d) => (
      <>
        Your Refund Request for <b>{d.courseTitle}</b> was declined
      </>
    ),
    detail: (d) => d.note,
  },
  "open-refund-request": {
    category: "refunds",
    icon: <Receipt className="size-4" />,
    tone: "text-orange-600 bg-orange-100 dark:bg-orange-900/30",
    line: (d) => (
      <>
        <b>{d.actorName}</b> requested a refund for <b>{d.courseTitle}</b>
      </>
    ),
    detail: (d) => d.reason && `“${d.reason}”`,
  },
};

const FALLBACK_KIND = {
  category: "discussion" as Category,
  icon: <Bell className="size-4" />,
  tone: "text-muted-foreground bg-muted",
  line: (d: FeedItem["data"]) => <>{d.text ?? "Notification"}</>,
};

function kindOf(item: FeedItem) {
  return KINDS[item.data.kind ?? ""] ?? FALLBACK_KIND;
}

function useOpenNotification(onDone?: () => void) {
  const { mark } = useFeed();
  const navigate = useNavigate();
  return (item: FeedItem) => {
    if (!item.read_at) mark("read", [item.id]);
    onDone?.();
    if (item.data.url) navigate(item.data.url);
  };
}

// ---------------------------------------------------------------------------
// Variant A — bell popover
// ---------------------------------------------------------------------------

function BellA() {
  const { items, mark } = useFeed();
  const [open, setOpen] = useState(false);
  const { unseen, unread } = counts(items);
  const openItem = useOpenNotification(() => setOpen(false));

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) mark("seen", items.filter((i) => !i.seen_at).map((i) => i.id));
  }

  return (
    <>
      <button
        onClick={toggle}
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
      >
        <Bell className="size-5" />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-[13.5rem] top-3 z-50 flex max-h-[75vh] w-96 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="font-semibold">Notifications</span>
              <button
                disabled={unread === 0}
                onClick={() => mark("read", items.filter((i) => !i.read_at).map((i) => i.id))}
                className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                Mark all as read
              </button>
            </div>
            <div className="overflow-y-auto">
              {items.length === 0 && <Empty />}
              {items.map((item) => {
                const k = kindOf(item);
                const detail = "detail" in k ? k.detail?.(item.data) : null;
                return (
                  <button
                    key={item.id}
                    onClick={() => openItem(item)}
                    className={cn(
                      "flex w-full gap-3 border-b px-4 py-3 text-left text-sm last:border-0 hover:bg-accent",
                      !item.read_at && "bg-primary/5"
                    )}
                  >
                    <UserAvatar
                      name={item.data.actorName ?? "Cadence"}
                      avatarUrl={item.data.actorAvatarUrl ?? null}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className={cn(item.read_at && "text-muted-foreground")}>
                        {k.line(item.data)}
                      </div>
                      {detail && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {detail}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatRelativeTime(item.inserted_at)}
                      </div>
                    </div>
                    {!item.read_at && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-600" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Variant B — nav button + right-hand drawer
// ---------------------------------------------------------------------------

function DrawerB() {
  const { items, mark } = useFeed();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const { unread } = counts(items);
  const openItem = useOpenNotification(() => setOpen(false));
  const shown = tab === "unread" ? items.filter((i) => !i.read_at) : items;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        Notifications
        {unread > 0 && (
          <span className="ml-auto rounded-full bg-primary px-2 text-xs font-semibold leading-5 text-primary-foreground">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l bg-background shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b px-5">
              <span className="text-lg font-semibold">Notifications</span>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex items-center gap-1 border-b px-5 py-2 text-sm">
              {(["unread", "all"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-full px-3 py-1 capitalize",
                    tab === t ? "bg-foreground text-background" : "hover:bg-accent"
                  )}
                >
                  {t}
                  {t === "unread" && unread > 0 && ` (${unread})`}
                </button>
              ))}
              <button
                disabled={unread === 0}
                onClick={() => mark("read", items.filter((i) => !i.read_at).map((i) => i.id))}
                className="ml-auto text-xs text-primary hover:underline disabled:text-muted-foreground"
              >
                Mark all as read
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {shown.length === 0 && (
                <Empty text={tab === "unread" ? "You're all caught up." : undefined} />
              )}
              {shown.map((item) => (
                <RowB key={item.id} item={item} onOpen={openItem} />
              ))}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function RowB({ item, onOpen }: { item: FeedItem; onOpen: (i: FeedItem) => void }) {
  const { mark } = useFeed();
  const k = kindOf(item);
  const detail = "detail" in k ? k.detail?.(item.data) : null;
  return (
    <div
      className={cn(
        "group relative flex gap-3 rounded-lg border p-3 text-sm",
        !item.read_at ? "border-l-4 border-l-primary" : "opacity-70"
      )}
    >
      <div
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", k.tone)}
      >
        {k.icon}
      </div>
      <button onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
        <div>{k.line(item.data)}</div>
        {detail && (
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          {formatRelativeTime(item.inserted_at)}
        </div>
      </button>
      <button
        onClick={() => mark(item.read_at ? "unread" : "read", [item.id])}
        className="invisible self-start rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent group-hover:visible"
      >
        {item.read_at ? "Mark unread" : "Mark read"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant D — the pick: A's bell + badge, B's rows, C's filters; count unread
// ---------------------------------------------------------------------------

function BellD() {
  const { items, mark } = useFeed();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Category | null>(null);
  const { unread } = counts(items);
  const openItem = useOpenNotification(() => setOpen(false));
  const shown = filter ? items.filter((i) => kindOf(i).category === filter) : items;
  const unreadShown = shown.filter((i) => !i.read_at);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-[13.5rem] top-3 z-50 flex max-h-[80vh] w-[420px] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="font-semibold">Notifications</span>
              <button
                disabled={unreadShown.length === 0}
                onClick={() => mark("read", unreadShown.map((i) => i.id))}
                className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                Mark all as read
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 border-b px-4 py-2 text-xs">
              {CATEGORIES.map((c) => {
                const n = items.filter(
                  (i) => !i.read_at && (c.key === null || kindOf(i).category === c.key)
                ).length;
                return (
                  <button
                    key={c.label}
                    onClick={() => setFilter(c.key)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5",
                      filter === c.key ? "border-foreground bg-foreground text-background" : "hover:bg-accent"
                    )}
                  >
                    {c.label}
                    {n > 0 && <span className="ml-1 opacity-70">{n}</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {shown.length === 0 && <Empty />}
              {shown.map((item) => (
                <RowB key={item.id} item={item} onOpen={openItem} />
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Variant C — nav link + full page, toast on arrival
// ---------------------------------------------------------------------------

function NavC() {
  const { items } = useFeed();
  const { unread } = counts(items);
  return (
    <NavLink
      to="/prototype/notifications?variant=C"
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Bell className="size-4" />
      Notifications
      {unread > 0 && (
        <span className="ml-auto text-xs font-semibold text-primary">{unread} new</span>
      )}
    </NavLink>
  );
}

function ArrivalToastsC() {
  const { items } = useFeed();
  const openItem = useOpenNotification();
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (items.length === 0 && known.current === null) return;
    if (known.current === null) {
      known.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !known.current!.has(i.id));
    fresh.forEach((i) => known.current!.add(i.id));
    for (const item of fresh.slice(0, 3).reverse()) {
      const k = kindOf(item);
      toast(<span>{k.line(item.data)}</span>, {
        icon: k.icon,
        action: { label: "View", onClick: () => openItem(item) },
      });
    }
    if (fresh.length > 3) toast(`+${fresh.length - 3} more Notifications`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  return null;
}

const CATEGORIES: { key: Category | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "discussion", label: "Discussion" },
  { key: "refunds", label: "Refunds" },
  { key: "enrollments", label: "Enrollments" },
  { key: "team", label: "Team" },
];

export function FeedPage({ filter }: { filter: string | null }) {
  const { items, mark, error } = useFeed();
  const [params, setParams] = useSearchParams();
  const openItem = useOpenNotification();
  const shown = filter ? items.filter((i) => kindOf(i).category === filter) : items;
  const unreadShown = shown.filter((i) => !i.read_at);

  // Arriving on the page counts as having seen everything.
  useEffect(() => {
    const unseen = items.filter((i) => !i.seen_at).map((i) => i.id);
    if (unseen.length) mark("seen", unseen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 rounded border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        PROTOTYPE page for variant C. In variants A and B the feed isn't a page at all.
      </div>
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <button
          disabled={unreadShown.length === 0}
          onClick={() => mark("read", unreadShown.map((i) => i.id))}
          className="text-sm text-primary hover:underline disabled:text-muted-foreground"
        >
          Mark all as read
        </button>
      </div>
      {error && <p className="text-sm text-red-600">Knock: {error}</p>}
      <div className="flex gap-8">
        <nav className="w-40 shrink-0 space-y-1 text-sm">
          {CATEGORIES.map((c) => {
            const n = items.filter(
              (i) => !i.read_at && (c.key === null || kindOf(i).category === c.key)
            ).length;
            return (
              <button
                key={c.label}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  if (c.key) next.set("kind", c.key);
                  else next.delete("kind");
                  setParams(next, { replace: true });
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-1.5",
                  filter === c.key ? "bg-accent font-medium" : "hover:bg-accent/60"
                )}
              >
                {c.label}
                {n > 0 && <span className="text-xs text-muted-foreground">{n}</span>}
              </button>
            );
          })}
        </nav>
        <div className="flex-1 divide-y rounded-lg border">
          {shown.length === 0 && <Empty />}
          {shown.map((item) => {
            const k = kindOf(item);
            const detail = "detail" in k ? k.detail?.(item.data) : null;
            return (
              <div
                key={item.id}
                className={cn(
                  "group flex items-center gap-4 px-4 py-3 text-sm",
                  !item.read_at && "font-medium"
                )}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    item.read_at ? "bg-transparent" : "bg-blue-600"
                  )}
                />
                <div className={cn("shrink-0", k.tone, "rounded p-1")}>{k.icon}</div>
                <button onClick={() => openItem(item)} className="min-w-0 flex-1 text-left">
                  <div className={cn("truncate", item.read_at && "font-normal text-muted-foreground")}>
                    {k.line(item.data)}
                  </div>
                  {detail && (
                    <div className="truncate text-xs font-normal text-muted-foreground">
                      {detail}
                    </div>
                  )}
                </button>
                <span className="shrink-0 text-xs font-normal text-muted-foreground group-hover:hidden">
                  {formatRelativeTime(item.inserted_at)}
                </span>
                <div className="hidden shrink-0 gap-1 group-hover:flex">
                  <button
                    onClick={() => mark(item.read_at ? "unread" : "read", [item.id])}
                    className="rounded px-2 py-0.5 text-xs font-normal hover:bg-accent"
                  >
                    {item.read_at ? "Unread" : "Read"}
                  </button>
                  <button
                    title="Archive"
                    onClick={() => mark("archived", [item.id])}
                    className="rounded p-1 hover:bg-accent"
                  >
                    <Archive className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Empty({ text = "No Notifications yet." }: { text?: string }) {
  return <p className="px-4 py-10 text-center text-sm text-muted-foreground">{text}</p>;
}

// ---------------------------------------------------------------------------
// Mount points used by the sidebar, plus the switcher
// ---------------------------------------------------------------------------

export function FeedSidebarHeaderSlot() {
  const [variant] = useVariant();
  if (variant === "A") return <BellA />;
  if (variant === "D") return <BellD />;
  return null;
}

export function FeedSidebarNavSlot() {
  const [variant] = useVariant();
  if (variant === "B") return <DrawerB />;
  if (variant === "C")
    return (
      <>
        <NavC />
        <ArrivalToastsC />
      </>
    );
  return null;
}

export function PrototypeSwitcher() {
  const [variant, setVariant] = useVariant();
  const { items, meta, error } = useFeed();
  const seed = useFetcher<{ seeded: number; recipient: string }>();
  const { unread, unseen } = counts(items);
  const idx = VARIANTS.indexOf(variant);
  const go = (d: number) => setVariant(VARIANTS[(idx + d + VARIANTS.length) % VARIANTS.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-2xl ring-2 ring-amber-400">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/20">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-36 text-center font-medium">
        {variant} ({VARIANT_NAMES[variant]})
      </span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/20">
        <ChevronRight className="size-4" />
      </button>
      <span className="border-l border-white/30 pl-3 font-mono text-xs text-white/70">
        {error
          ? `knock: ${error}`
          : `unread ${unread} · unseen ${unseen} · total ${meta?.total_count ?? "…"}`}
      </span>
      <seed.Form method="post" action="/prototype/notifications">
        <button
          type="submit"
          disabled={seed.state !== "idle"}
          className="rounded-full bg-amber-400 px-3 py-0.5 text-xs font-semibold text-zinc-900 hover:bg-amber-300 disabled:opacity-50"
        >
          {seed.state !== "idle" ? "Seeding…" : "Seed 7 for me"}
        </button>
      </seed.Form>
    </div>
  );
}
