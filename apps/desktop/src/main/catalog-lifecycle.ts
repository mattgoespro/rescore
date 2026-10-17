import {
  assign,
  createActor,
  fromCallback,
  fromPromise,
  setup,
  stateIn,
  waitFor,
} from "xstate";
import type { BackgroundServiceStatus } from "../shared/background-service";
import type {
  CatalogStatus,
  TmdbHydrationProgress,
} from "../shared/catalog-status";
import { catalogStatusSnapshot } from "./catalog-status-snapshot";
import { shouldFinishCatalogPoll } from "./catalog-poll";
import { settleHealthMiss, shouldRestartHungChild } from "./api-watch";
import type { ServiceMaintenanceAction } from "./service-launch";

export type ServiceIntent = "launch" | "repair" | "observe";
export interface ServiceInspection {
  status: BackgroundServiceStatus;
  activity: "idle" | "busy" | "unknown";
  action: ServiceMaintenanceAction;
}
export interface Probe {
  health: CatalogStatus | null;
  childAlive: boolean;
  portOpen: boolean;
}
export interface LifecycleAdapters {
  serviceOwned(): boolean;
  inspect(
    intent: ServiceIntent,
    signal: AbortSignal,
  ): Promise<ServiceInspection>;
  maintain(
    action: Exclude<ServiceMaintenanceAction, "none">,
  ): Promise<BackgroundServiceStatus>;
  block(): void;
  probe(signal: AbortSignal): Promise<Probe>;
  spawn(): Promise<void>;
  killOwned(): Promise<void>;
  stopOwned(): Promise<void>;
  rebuild(signal: AbortSignal): Promise<void>;
  subscribeHydration(
    report: (progress: TmdbHydrationProgress) => void,
  ): () => void;
  publish(status: CatalogStatus): void;
}
type Waiter = {
  resolve(status: BackgroundServiceStatus): void;
  reject(error: Error): void;
};
type Event =
  | { type: "START" | "RECONNECT" | "STOP" | "REBUILD" | "CHILD_EXIT" }
  | { type: "REPAIR"; waiter: Waiter }
  | { type: "HYDRATION"; progress: TmdbHydrationProgress };
interface Context {
  status: CatalogStatus;
  service: BackgroundServiceStatus;
  activity: ServiceInspection["activity"];
  intent: ServiceIntent;
  action: Exclude<ServiceMaintenanceAction, "none">;
  launchUsed: boolean;
  attempts: number;
  misses: number;
  mode: "poll" | "watch";
  waiters: Waiter[];
}

export function createCatalogLifecycle(
  adapters: LifecycleAdapters,
  options: {
    clock?: {
      setTimeout(fn: (...args: unknown[]) => void, timeout: number): unknown;
      clearTimeout(id: unknown): void;
    };
    timings?: Partial<{
      watch: number;
      poll: number;
      backoff: number;
      start: number;
      stop: number;
    }>;
  } = {},
) {
  const times = {
    watch: 3000,
    poll: 250,
    backoff: 800,
    start: 30000,
    stop: 32000,
    ...options.timings,
  };
  const initial: Context = {
    status: {
      phase: "starting",
      message: "Starting the local catalog…",
      titleCount: 0,
      builtAt: null,
      error: null,
      download: null,
      titlesUpdateAvailable: false,
      creditsFailed: false,
      catalogUsable: false,
    },
    service: {
      supported: adapters.serviceOwned(),
      enabled: false,
      state: "not-installed",
      message: "Checking the catalogue service…",
    },
    intent: "launch",
    activity: "idle",
    action: "EnsureRunning",
    launchUsed: false,
    attempts: 0,
    misses: 0,
    mode: "poll",
    waiters: [],
  };
  const errorStatus = (context: Context, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return catalogStatusSnapshot(context.status, {
      phase: "error",
      message,
      error: message,
      download: null,
    });
  };
  const probeChange = (context: Context, probe: Probe): Partial<Context> =>
    probe.health
      ? {
          status: catalogStatusSnapshot(context.status, probe.health),
          misses: 0,
          attempts: 0,
          mode: shouldFinishCatalogPoll(probe.health) ? "watch" : "poll",
          ...(adapters.serviceOwned()
            ? {
                service: {
                  ...context.service,
                  enabled: true,
                  state: "running" as const,
                  message: "Catalogue upkeep continues when Rescore is closed.",
                },
              }
            : {}),
        }
      : { misses: context.misses + 1 };
  const machine = setup({
    types: { context: {} as Context, events: {} as Event },
    actors: {
      inspect: fromPromise<ServiceInspection, { intent: ServiceIntent }>(
        ({ input, signal }) => adapters.inspect(input.intent, signal),
      ),
      maintain: fromPromise<
        BackgroundServiceStatus,
        { action: Exclude<ServiceMaintenanceAction, "none"> }
      >(({ input }) => adapters.maintain(input.action)),
      probe: fromPromise<Probe>(({ signal }) => adapters.probe(signal)),
      spawn: fromPromise(() => adapters.spawn()),
      kill: fromPromise(() => adapters.killOwned()),
      stop: fromPromise(() => adapters.stopOwned()),
      rebuild: fromPromise(({ signal }) => adapters.rebuild(signal)),
      hydration: fromCallback(({ sendBack }) =>
        adapters.subscribeHydration((progress) =>
          sendBack({ type: "HYDRATION", progress }),
        ),
      ),
    },
    delays: {
      observe: times.watch,
      poll: ({ context }) =>
        context.mode === "watch" ? times.watch : times.poll,
      backoff: ({ context }) =>
        Math.min(times.backoff * 2 ** Math.max(0, context.attempts - 1), 8000),
      connection: times.start,
      shutdown: times.stop,
    },
    guards: {
      closingQuiescence: stateIn({ quiescing: "closing" }),
      closingTermination: stateIn({ killingChild: "closing" }),
    },
    actions: {
      addWaiter: assign(({ context, event }) =>
        event.type === "REPAIR"
          ? { waiters: [...context.waiters, event.waiter] }
          : {},
      ),
      finishWaiters: ({ context }) => {
        for (const waiter of context.waiters) waiter.resolve(context.service);
      },
      clearWaiters: assign({ waiters: () => [] }),
      closing: ({ context }) => {
        for (const waiter of context.waiters)
          waiter.reject(new Error("Rescore is closing."));
      },
      block: () => adapters.block(),
      maintenanceBusy: assign(({ context, event }) => {
        const inspection = (event as unknown as { output: ServiceInspection })
          .output;
        const message =
          inspection.activity === "busy"
            ? "Catalogue maintenance is still running."
            : "Cannot verify catalogue maintenance state.";
        return {
          activity: inspection.activity,
          intent: "observe" as const,
          service: {
            ...inspection.status,
            state:
              inspection.activity === "busy"
                ? ("transitioning" as const)
                : ("error" as const),
            message,
          },
          status: errorStatus(context, message),
        };
      }),
      acceptProbe: assign(({ context, event }) =>
        probeChange(context, (event as unknown as { output: Probe }).output),
      ),
      failure: assign(({ context, event }) => ({
        status: errorStatus(
          context,
          (event as unknown as { error: unknown }).error,
        ),
      })),
    },
  }).createMachine({
    id: "catalogue",
    initial: "inactive",
    context: initial,
    on: {
      STOP: { target: ".stopping", actions: ["closing", "clearWaiters"] },
      REPAIR: {
        target: ".inspecting",
        reenter: true,
        actions: ["addWaiter", assign({ intent: () => "repair" })],
      },
      RECONNECT: {
        guard: ({ context }) => context.waiters.length === 0,
        target: ".inspecting",
        actions: assign({
          intent: () => "observe",
          attempts: () => 0,
          misses: () => 0,
        }),
      },
      REBUILD: {
        guard: ({ context }) =>
          context.activity === "idle" && context.waiters.length === 0,
        target: ".requestingRebuild",
      },
    },
    states: {
      inactive: { on: { START: "inspecting" } },
      inspecting: {
        on: {
          REPAIR: {
            guard: ({ context }) => context.waiters.length > 0,
            actions: "addWaiter",
          },
        },
        invoke: {
          src: "inspect",
          input: ({ context }) => ({ intent: context.intent }),
          onDone: [
            {
              guard: ({ context, event }) =>
                event.output.action !== "none" &&
                event.output.activity === "idle" &&
                (context.intent === "repair" ||
                  (context.intent === "launch" && !context.launchUsed)),
              target: "quiescing",
              actions: assign(({ context, event }) => ({
                service: event.output.status,
                activity: event.output.activity,
                action: event.output.action as Context["action"],
                launchUsed: context.launchUsed || context.intent === "launch",
              })),
            },
            {
              guard: ({ event }) => event.output.activity !== "idle",
              target: "unavailable",
              actions: [
                "block",
                "maintenanceBusy",
                "finishWaiters",
                "clearWaiters",
              ],
            },
            {
              target: "probing",
              actions: [
                assign(({ event }) => ({
                  service: event.output.status,
                  activity: event.output.activity,
                })),
                "finishWaiters",
                "clearWaiters",
              ],
            },
          ],
          onError: {
            target: "unavailable",
            actions: [
              "failure",
              "block",
              assign(({ context, event }) => ({
                activity: "unknown" as const,
                service: {
                  ...context.service,
                  state: "error" as const,
                  message:
                    event.error instanceof Error
                      ? event.error.message
                      : String(event.error),
                },
              })),
              "finishWaiters",
              "clearWaiters",
            ],
          },
        },
      },
      quiescing: {
        initial: "preparing",
        states: {
          preparing: {},
          closing: { after: { shutdown: "#catalogue.stopped" } },
        },
        entry: [
          "block",
          assign(({ context }) => ({
            status: catalogStatusSnapshot(context.status, {
              phase: "starting",
              message: "Preparing the required catalogue service…",
              error: null,
            }),
            service: {
              ...context.service,
              state: "transitioning" as const,
              message: "Preparing the required catalogue service…",
            },
          })),
        ],
        on: {
          STOP: { target: ".closing", actions: ["closing", "clearWaiters"] },
          REPAIR: { actions: "addWaiter" },
          RECONNECT: {},
          REBUILD: {},
        },
        invoke: {
          src: "stop",
          onDone: [
            { guard: "closingQuiescence", target: "stopped" },
            { target: "maintaining" },
          ],
          onError: [
            { guard: "closingQuiescence", target: "stopped" },
            {
              target: "unavailable",
              actions: ["failure", "finishWaiters", "clearWaiters"],
            },
          ],
        },
      },
      maintaining: {
        on: { REPAIR: { actions: "addWaiter" }, RECONNECT: {}, REBUILD: {} },
        invoke: {
          src: "maintain",
          input: ({ context }) => ({ action: context.action }),
          onDone: {
            target: "refreshingService",
            actions: assign(({ event }) => ({ service: event.output })),
          },
          onError: {
            target: "refreshingService",
            actions: [
              "failure",
              assign(({ context, event }) => ({
                service: {
                  ...context.service,
                  state: "error" as const,
                  message: String(event.error),
                },
              })),
            ],
          },
        },
      },
      refreshingService: {
        on: { REPAIR: { actions: "addWaiter" }, RECONNECT: {}, REBUILD: {} },
        invoke: {
          src: "inspect",
          input: { intent: "observe" },
          onDone: [
            {
              guard: ({ event }) => event.output.activity !== "idle",
              target: "unavailable",
              actions: [
                "block",
                "maintenanceBusy",
                "finishWaiters",
                "clearWaiters",
              ],
            },
            {
              target: "probing",
              actions: [
                assign(({ context, event }) => ({
                  activity: event.output.activity,
                  service:
                    context.service.state === "error" &&
                    event.output.status.state !== "running"
                      ? {
                          ...event.output.status,
                          state: "error" as const,
                          message: context.service.message,
                        }
                      : event.output.status,
                  intent: "observe" as const,
                })),
                "finishWaiters",
                "clearWaiters",
              ],
            },
          ],
          onError: {
            target: "unavailable",
            actions: [
              "failure",
              "block",
              assign({ activity: () => "unknown" as const }),
              "finishWaiters",
              "clearWaiters",
            ],
          },
        },
      },
      probing: {
        invoke: {
          src: "probe",
          onDone: [
            {
              guard: ({ event }) => !!event.output.health,
              target: "online",
              actions: "acceptProbe",
            },
            { guard: () => adapters.serviceOwned(), target: "unavailable" },
            {
              guard: ({ event }) =>
                event.output.childAlive || event.output.portOpen,
              target: "awaitingConnection",
            },
            {
              guard: ({ context }) => context.attempts > 5,
              target: "unavailable",
            },
            { target: "launching" },
          ],
          onError: { target: "unavailable", actions: "failure" },
        },
      },
      launching: {
        invoke: {
          src: "spawn",
          onDone: "awaitingConnection",
          onError: {
            target: "unavailable",
            actions: ["failure", assign({ attempts: () => 6 })],
          },
        },
      },
      awaitingConnection: {
        initial: "check",
        after: { connection: "recovery" },
        states: {
          check: {
            invoke: {
              src: "probe",
              onDone: [
                {
                  guard: ({ event }) => !!event.output.health,
                  target: "#catalogue.online",
                  actions: "acceptProbe",
                },
                { target: "wait" },
              ],
              onError: "wait",
            },
          },
          wait: { after: { poll: "check" } },
        },
      },
      online: {
        invoke: { src: "hydration" },
        initial: "wait",
        on: {
          HYDRATION: {
            actions: assign(({ context, event }) => ({
              status: catalogStatusSnapshot(context.status, {
                phase: context.status.phase,
                message: context.status.message,
                tmdbHydration: event.progress,
              }),
            })),
          },
          CHILD_EXIT: { target: ".check" },
        },
        states: {
          wait: { after: { poll: "check" } },
          check: {
            invoke: {
              src: "probe",
              onDone: [
                {
                  guard: ({ event }) => !!event.output.health,
                  target: "wait",
                  actions: "acceptProbe",
                },
                {
                  guard: ({ context }) =>
                    adapters.serviceOwned() && context.misses + 1 >= 3,
                  target: "#catalogue.unavailable",
                },
                {
                  guard: () => adapters.serviceOwned(),
                  target: "wait",
                  actions: "acceptProbe",
                },
                {
                  guard: ({ context, event }) =>
                    event.output.childAlive &&
                    context.mode === "watch" &&
                    shouldRestartHungChild(context.misses + 1),
                  target: "#catalogue.killingChild",
                  actions: "acceptProbe",
                },
                {
                  guard: ({ context, event }) =>
                    !event.output.childAlive &&
                    !event.output.portOpen &&
                    (context.mode === "watch" ||
                      settleHealthMiss({
                        ...event.output,
                        missed: context.misses + 1,
                      }) === "give-up"),
                  target: "#catalogue.recovery",
                  actions: "acceptProbe",
                },
                {
                  target: "wait",
                  actions: [
                    "acceptProbe",
                    assign(({ context, event }) =>
                      !event.output.childAlive && event.output.portOpen
                        ? { misses: 0 }
                        : {
                            status: catalogStatusSnapshot(context.status, {
                              phase: "starting",
                              message: "Waiting for the catalog API…",
                              error: null,
                            }),
                          },
                    ),
                  ],
                },
              ],
              onError: { target: "#catalogue.unavailable", actions: "failure" },
            },
          },
        },
      },
      killingChild: {
        initial: "recovering",
        states: {
          recovering: {},
          closing: { after: { shutdown: "#catalogue.stopped" } },
        },
        on: {
          STOP: { target: ".closing", actions: ["closing", "clearWaiters"] },
          REPAIR: { actions: "addWaiter" },
          RECONNECT: {},
          REBUILD: {},
        },
        invoke: {
          src: "kill",
          onDone: [
            { guard: "closingTermination", target: "stopped" },
            {
              guard: ({ context }) => context.waiters.length > 0,
              target: "inspecting",
              actions: assign({ intent: () => "repair" as const }),
            },
            { target: "recovery" },
          ],
          onError: [
            { guard: "closingTermination", target: "stopped" },
            {
              target: "unavailable",
              actions: ["failure", "finishWaiters", "clearWaiters"],
            },
          ],
        },
      },
      recovery: {
        always: {
          guard: ({ context }) => context.attempts > 5,
          target: "unavailable",
        },
        entry: assign(({ context }) => ({
          attempts: context.attempts + 1,
          misses: 0,
          mode: "poll" as const,
          status: catalogStatusSnapshot(context.status, {
            phase: "starting",
            message: "Catalog API stopped; restarting…",
            error: null,
            download: null,
          }),
        })),
        after: { backoff: "probing" },
      },
      requestingRebuild: {
        entry: assign(({ context }) => ({
          status: catalogStatusSnapshot(context.status, {
            phase: "building",
            message: "Rebuilding catalog from IMDb datasets…",
            error: null,
            download: null,
          }),
          mode: "poll" as const,
        })),
        invoke: {
          src: "rebuild",
          onDone: "probing",
          onError: { target: "unavailable", actions: "failure" },
        },
      },
      unavailable: {
        entry: assign(({ context }) => ({
          intent: "observe" as const,
          status:
            context.status.phase === "error"
              ? context.status
              : errorStatus(
                  context,
                  adapters.serviceOwned()
                    ? "Background catalogue service is unavailable. Use Retry in Settings, or wait for it to recover."
                    : "Cannot reach the local catalogue. Use Retry or wait for it to recover.",
                ),
        })),
        after: { observe: "inspecting" },
      },
      stopping: {
        on: {
          START: {},
          STOP: {},
          REPAIR: {
            actions: ({ event }) =>
              event.waiter.reject(new Error("Rescore is closing.")),
          },
          RECONNECT: {},
          REBUILD: {},
        },
        invoke: { src: "stop", onDone: "stopped", onError: "stopped" },
        after: { shutdown: "stopped" },
      },
      stopped: { type: "final" },
    },
  });
  // Rebuild admission belongs to the machine. Maintenance states override it.
  const actor = createActor(
    machine,
    options.clock ? { clock: options.clock } : {},
  );
  let previous: CatalogStatus | undefined;
  actor.subscribe((snapshot) => {
    if (snapshot.context.status !== previous) {
      previous = snapshot.context.status;
      adapters.publish(previous);
    }
  });
  actor.start();
  const isClosed = () =>
    actor.getSnapshot().matches({ quiescing: "closing" }) ||
    actor.getSnapshot().matches({ killingChild: "closing" }) ||
    actor.getSnapshot().matches("stopping") ||
    actor.getSnapshot().matches("stopped");
  return {
    start: () => {
      actor.send({ type: "START" });
    },
    retry: () => {
      if (!isClosed()) actor.send({ type: "RECONNECT" });
    },
    repairService: () =>
      new Promise<BackgroundServiceStatus>((resolve, reject) => {
        if (isClosed()) {
          reject(new Error("Rescore is closing."));
          return;
        }
        actor.send({ type: "REPAIR", waiter: { resolve, reject } });
      }),
    rebuild: (): CatalogStatus => {
      if (isClosed()) throw new Error("Rescore is closing.");
      if (!actor.getSnapshot().can({ type: "REBUILD" }))
        throw new Error(
          "Catalogue maintenance is running. Wait for it to finish, then rebuild.",
        );
      actor.send({ type: "REBUILD" });
      return actor.getSnapshot().context.status;
    },
    status: () => actor.getSnapshot().context.status,
    serviceStatus: () => actor.getSnapshot().context.service,
    childExited: () => {
      if (!isClosed()) actor.send({ type: "CHILD_EXIT" });
    },
    state: () => actor.getSnapshot().value,
    stop: async () => {
      if (!isClosed()) actor.send({ type: "STOP" });
      await waitFor(actor, (snapshot) => snapshot.matches("stopped"));
    },
  };
}
