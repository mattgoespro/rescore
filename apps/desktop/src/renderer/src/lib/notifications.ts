export type NoticeTone = "success" | "error";

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
  /** Reverses the action the notice reports; absent when nothing can. */
  undo?: () => Promise<void> | void;
}

export type NoticeInput = Omit<Notice, "id">;

/** At most this many notices show; older ones give way to newer. */
export const NOTICE_LIMIT = 3;

/** How long a notice stays, longer when it offers an undo. */
export function noticeDuration(notice: Pick<Notice, "undo">): number {
  return notice.undo ? 8000 : 5000;
}

/**
 * Adds a notice at the end (the bottom of the stack), dropping the oldest. A
 * repeat of a notice already showing replaces it rather than stacking.
 */
export function pushNotice(notices: Notice[], notice: Notice): Notice[] {
  const others = notice.undo
    ? notices
    : notices.filter(
        (shown) =>
          shown.undo ||
          shown.tone !== notice.tone ||
          shown.message !== notice.message,
      );
  return [...others, notice].slice(-NOTICE_LIMIT);
}

export function dropNotice(notices: Notice[], id: number): Notice[] {
  return notices.filter((notice) => notice.id !== id);
}
