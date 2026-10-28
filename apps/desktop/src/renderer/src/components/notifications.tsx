import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";
import {
  dropNotice,
  noticeDuration,
  pushNotice,
  type Notice,
  type NoticeInput,
} from "../lib/notifications";
import { iconBtn } from "../lib/ui";
import { IconCheck, IconClose, IconUndo } from "./icons";

type Notify = (notice: NoticeInput) => void;

const NotifyContext = createContext<Notify>(() => undefined);

/** Raises a notice in the bottom-right stack. */
export function useNotify(): Notify {
  return useContext(NotifyContext);
}

/**
 * Holds the notices and draws them in the bottom-right corner, over the
 * page, so reporting an action never takes space from the page itself.
 */
export function NotificationsProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(1);
  const notify = useCallback<Notify>((notice) => {
    const id = nextId.current++;
    setNotices((current) => pushNotice(current, { ...notice, id }));
  }, []);
  const dismiss = useCallback((id: number) => {
    setNotices((current) => dropNotice(current, id));
  }, []);
  const value = useMemo(() => notify, [notify]);

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-90 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {notices.map((notice) => (
          <Toast key={notice.id} notice={notice} onDismiss={dismiss} />
        ))}
      </section>
    </NotifyContext.Provider>
  );
}

function Toast({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: (id: number) => void;
}): JSX.Element {
  const [paused, setPaused] = useState(false);
  const [undoing, setUndoing] = useState(false);

  // The clock restarts whenever the pointer or focus leaves the notice.
  useEffect(() => {
    if (paused || undoing) return;
    const handle = window.setTimeout(
      () => onDismiss(notice.id),
      noticeDuration(notice),
    );
    return () => window.clearTimeout(handle);
  }, [paused, undoing, notice, onDismiss]);

  async function undo(): Promise<void> {
    if (!notice.undo || undoing) return;
    setUndoing(true);
    try {
      await notice.undo();
    } finally {
      onDismiss(notice.id);
    }
  }

  return (
    <div
      className="pointer-events-auto flex animate-fade items-center gap-3 rounded-control border border-line bg-raised py-2 pr-1.5 pl-3 text-[13px] text-ink"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setPaused(false);
      }}
    >
      {notice.tone === "success" ? (
        <IconCheck className="size-4 shrink-0 text-accent-text" />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-4 shrink-0 place-items-center rounded-full bg-danger text-[11px] font-bold text-canvas"
        >
          !
        </span>
      )}
      <p className="m-0 min-w-0 flex-1 leading-copy text-pretty">
        {notice.message}
      </p>
      {notice.undo ? (
        <button
          type="button"
          className={cn(iconBtn("bare"), "size-8 text-accent-text")}
          aria-label="Undo"
          title="Undo"
          disabled={undoing}
          onClick={() => void undo()}
        >
          <IconUndo className="size-4" />
        </button>
      ) : null}
      <button
        type="button"
        className={cn(iconBtn("bare"), "size-8")}
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={() => onDismiss(notice.id)}
      >
        <IconClose className="size-3.5" />
      </button>
    </div>
  );
}
