import assert from "node:assert/strict";
import { test } from "node:test";
import { SimulatedClock } from "xstate";
import {
  createCatalogLifecycle,
  type LifecycleAdapters,
  type Probe,
} from "./catalog-lifecycle";
import type { CatalogStatus } from "../shared/catalog-status";
const ready: CatalogStatus = {
  phase: "ready",
  message: "ready",
  titleCount: 2,
  builtAt: "fixture",
  error: null,
  download: null,
  titlesUpdateAvailable: false,
  creditsFailed: false,
  catalogUsable: true,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("transient service health misses retain readiness; repeated misses fail and recover", async () => {
  const f = fixture();
  f.setHealthy(true);
  f.runtime.start();
  await tick();
  await tick();
  assert.equal(f.runtime.status().phase, "ready");
  f.setHealthy(false);
  for (let miss = 0; miss < 2; miss++) {
    f.clock.increment(10);
    await tick();
    assert.equal(f.runtime.status().phase, "ready");
  }
  f.setHealthy(true);
  f.clock.increment(10);
  await tick();
  assert.equal(f.runtime.status().phase, "ready");
  f.setHealthy(false);
  for (let miss = 0; miss < 3; miss++) {
    f.clock.increment(10);
    await tick();
  }
  assert.equal(f.runtime.status().phase, "error");
  assert.equal(f.calls, 0);
  f.setHealthy(true);
  f.clock.increment(10);
  await tick();
  await tick();
  assert.equal(f.runtime.status().phase, "ready");
  await f.runtime.stop();
});
function fixture() {
  const clock = new SimulatedClock();
  let healthy = false;
  let calls = 0;
  let child = false;
  let occupied = false;
  let release!: () => void;
  let holdMaintenance = false;
  const service = {
    supported: true,
    enabled: true,
    state: "stopped" as const,
    message: "stopped",
  };
  const adapters: LifecycleAdapters = {
    serviceOwned: () => true,
    inspect: async (intent) => ({
      status: { ...service, state: healthy ? "running" : "stopped" },
      activity: "idle",
      action: intent === "observe" || healthy ? "none" : "EnsureRunning",
    }),
    maintain: async () => {
      calls++;
      if (holdMaintenance)
        await new Promise<void>((r) => {
          release = r;
        });
      return { ...service, state: healthy ? "running" : "stopped" };
    },
    block: () => {},
    probe: async () => ({
      health: healthy ? ready : null,
      childAlive: child,
      portOpen: occupied,
    }),
    spawn: async () => {
      child = true;
    },
    killOwned: async () => {
      child = false;
    },
    stopOwned: async () => {
      child = false;
    },
    rebuild: async () => {},
    subscribeHydration: () => () => {},
    publish: () => {},
  };
  const runtime = createCatalogLifecycle(adapters, {
    clock,
    timings: { watch: 10, poll: 1, backoff: 1, start: 30, stop: 32 },
  });
  return {
    runtime,
    adapters,
    clock,
    setHealthy: (x: boolean) => {
      healthy = x;
    },
    setOccupied: (x: boolean) => {
      occupied = x;
    },
    hold: () => {
      holdMaintenance = true;
    },
    release: () => release(),
    get calls() {
      return calls;
    },
    get child() {
      return child;
    },
  };
}
test("one launch preparation attempt is followed by passive initial recovery", async () => {
  const f = fixture();
  f.runtime.start();
  await tick();
  await tick();
  assert.equal(f.calls, 1);
  for (let i = 0; i < 3; i++) {
    f.clock.increment(10);
    await tick();
  }
  assert.equal(f.calls, 1);
  assert.equal(f.child, false);
  f.setHealthy(true);
  f.clock.increment(10);
  await tick();
  await tick();
  assert.equal(f.runtime.status().phase, "ready");
  await f.runtime.stop();
});
test("maintenance coalesces repair and rejects rebuild; close cannot restart runtime", async () => {
  const f = fixture();
  f.hold();
  f.runtime.start();
  await tick();
  const a = f.runtime.repairService(),
    b = f.runtime.repairService();
  assert.throws(() => f.runtime.rebuild(), /maintenance/i);
  const rejected = Promise.allSettled([a, b]);
  await f.runtime.stop();
  f.setHealthy(true);
  f.release();
  await tick();
  assert.equal(f.runtime.state(), "stopped");
  assert.equal(f.calls, 1);
  assert.ok((await rejected).every((x) => x.status === "rejected"));
});
test("an occupied port never causes a competing desktop child to spawn", async () => {
  const f = fixture();
  f.adapters.serviceOwned = () => false;
  f.setOccupied(true);
  f.runtime.start();
  await tick();
  assert.equal(f.child, false);
  f.clock.increment(30);
  await tick();
  assert.equal(f.child, false);
  await f.runtime.stop();
});
test("health changes after readiness update the UI and stale probes cannot undo stop", async () => {
  const f = fixture();
  f.setHealthy(true);
  f.runtime.start();
  await tick();
  f.adapters.probe = async () => ({
    health: { ...ready, phase: "building", catalogUsable: true },
    childAlive: false,
    portOpen: true,
  });
  f.clock.increment(10);
  await tick();
  assert.equal(f.runtime.status().phase, "building");
  let release!: (p: Probe) => void;
  f.adapters.probe = () =>
    new Promise((r) => {
      release = r;
    });
  f.clock.increment(1);
  await tick();
  await f.runtime.stop();
  release({ health: ready, childAlive: false, portOpen: true });
  await tick();
  assert.equal(f.runtime.state(), "stopped");
});

test("healthy launch skips maintenance and a rebuild immediately publishes building", async () => {
  const f = fixture();
  f.setHealthy(true);
  f.runtime.start();
  await tick();
  assert.equal(f.calls, 0);
  let rebuilds = 0;
  f.adapters.rebuild = async () => {
    rebuilds++;
  };
  assert.equal(f.runtime.rebuild().phase, "building");
  await tick();
  assert.equal(rebuilds, 1);
  assert.equal(f.runtime.status().phase, "ready");
  await f.runtime.stop();
});

test("authenticated health supersedes service facts captured during startup", async () => {
  const f = fixture();
  f.setHealthy(true);
  const original = f.adapters.inspect;
  f.adapters.inspect = async (intent, signal) => ({
    ...(await original(intent, signal)),
    status: {
      supported: true,
      enabled: true,
      state: "error",
      message: "Service was restarting",
    },
  });
  f.runtime.start();
  await tick();
  assert.equal(f.runtime.status().phase, "ready");
  assert.equal(f.runtime.serviceStatus().state, "running");
  assert.doesNotMatch(f.runtime.serviceStatus().message, /restarting/);
  await f.runtime.stop();
});
test("failed automatic maintenance is not repeated; explicit repair reports the failure", async () => {
  const f = fixture();
  let attempts = 0;
  f.adapters.maintain = async () => {
    attempts++;
    throw new Error("administrator approval cancelled");
  };
  f.runtime.start();
  await tick();
  f.clock.increment(10);
  await tick();
  assert.equal(attempts, 1);
  const repair = f.runtime.repairService();
  await tick();
  const status = await repair;
  assert.equal(attempts, 2);
  assert.equal(status.state, "error");
  assert.match(status.message, /cancelled/);
  await f.runtime.stop();
});
test("external busy or unknown maintenance prevents launching a second broker", async () => {
  for (const activity of ["busy", "unknown"] as const) {
    const f = fixture();
    const original = f.adapters.inspect;
    f.adapters.inspect = async (intent, signal) => ({
      ...(await original(intent, signal)),
      activity,
    });
    f.runtime.start();
    await tick();
    assert.equal(f.calls, 0);
    f.clock.increment(10);
    await tick();
    assert.equal(f.calls, 0);
    f.setHealthy(true);
    f.adapters.inspect = original;
    f.clock.increment(10);
    await tick();
    assert.equal(f.runtime.status().phase, "ready");
    assert.equal(f.calls, 0);
    await f.runtime.stop();
  }
});
test("explicit repair intent supersedes a pending launch inspection", async () => {
  const f = fixture();
  const intents: string[] = [];
  const pending: Array<
    (value: Awaited<ReturnType<LifecycleAdapters["inspect"]>>) => void
  > = [];
  f.adapters.inspect = async (intent) => {
    intents.push(intent);
    return new Promise((resolve) => pending.push(resolve));
  };
  f.runtime.start();
  const repair = f.runtime.repairService();
  assert.deepEqual(intents, ["launch", "repair"]);
  const running = {
    supported: true,
    enabled: true,
    state: "running" as const,
    message: "ready",
  };
  pending[1]({ status: running, activity: "idle", action: "none" });
  await repair;
  pending[0]({
    status: { ...running, state: "stopped" },
    activity: "idle",
    action: "EnsureRunning",
  });
  await tick();
  assert.equal(f.calls, 0);
  await f.runtime.stop();
});
test("recovery permits five desktop launch attempts and then only observes", async () => {
  const f = fixture();
  f.adapters.serviceOwned = () => false;
  f.setHealthy(true);
  let launches = 0;
  f.adapters.spawn = async () => {
    launches++;
  };
  f.runtime.start();
  await tick();
  f.setHealthy(false);
  for (let i = 0; i < 40; i++) {
    f.clock.increment(100);
    await tick();
  }
  assert.equal(launches, 5);
  f.setHealthy(true);
  f.clock.increment(100);
  await tick();
  assert.equal(f.runtime.status().phase, "ready");
  await f.runtime.stop();
});
test("hydration updates preserve phase and late stream messages cannot leave stopped", async () => {
  const f = fixture();
  let report!: Parameters<LifecycleAdapters["subscribeHydration"]>[0];
  let closed = 0;
  f.adapters.subscribeHydration = (handler) => {
    report = handler;
    return () => {
      closed++;
    };
  };
  f.setHealthy(true);
  f.runtime.start();
  await tick();
  const progress = {
    processed: 1,
    total: 2,
    percent: 50,
    complete: false,
    message: "metadata",
  };
  report(progress);
  assert.equal(f.runtime.status().phase, "ready");
  assert.deepEqual(f.runtime.status().tmdbHydration, progress);
  await f.runtime.stop();
  report({ ...progress, processed: 2, complete: true });
  assert.equal(closed, 1);
  assert.equal(f.runtime.state(), "stopped");
  assert.equal(f.runtime.status().tmdbHydration?.processed, 1);
});

test("repair preflight coalesces requests and rejects conflicting commands", async () => {
  const f = fixture();
  f.setHealthy(true);
  f.runtime.start();
  await tick();
  const original = f.adapters.inspect;
  let release!: () => void;
  let inspections = 0;
  f.adapters.inspect = async (intent, signal) => {
    inspections++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ...(await original(intent, signal)), action: "Retry" };
  };
  const first = f.runtime.repairService();
  const second = f.runtime.repairService();
  f.runtime.retry();
  assert.throws(() => f.runtime.rebuild(), /maintenance/i);
  assert.equal(inspections, 1);
  f.adapters.inspect = original;
  release();
  await Promise.all([first, second]);
  assert.equal(f.calls, 1);
  await f.runtime.stop();
});

test("observed maintenance blocks catalogue work until verified idle", async () => {
  for (const activity of ["busy", "unknown"] as const) {
    const f = fixture();
    f.setHealthy(true);
    const original = f.adapters.inspect;
    let blocked = 0;
    f.adapters.block = () => {
      blocked++;
    };
    f.adapters.inspect = async (intent, signal) => ({
      ...(await original(intent, signal)),
      activity,
    });
    f.runtime.start();
    await tick();
    assert.throws(() => f.runtime.rebuild(), /maintenance/i);
    assert.equal(blocked, 1);
    assert.notEqual(f.runtime.status().phase, "ready");
    f.adapters.inspect = original;
    f.clock.increment(10);
    await tick();
    assert.equal(f.runtime.rebuild().phase, "building");
    await tick();
    await f.runtime.stop();
  }
});

test("a broker timeout cannot reconnect while its Windows worker is still active", async () => {
  const f = fixture();
  const original = f.adapters.inspect;
  f.adapters.maintain = async () => {
    f.setHealthy(true);
    f.adapters.inspect = async (intent, signal) => ({
      ...(await original(intent, signal)),
      activity: "busy",
    });
    throw new Error("broker timed out");
  };
  f.runtime.start();
  await tick();
  assert.notEqual(f.runtime.status().phase, "ready");
  assert.throws(() => f.runtime.rebuild(), /maintenance/i);
  f.adapters.inspect = original;
  f.clock.increment(10);
  await tick();
  assert.equal(f.runtime.status().phase, "ready");
  await f.runtime.stop();
});

test("closing during quiescence awaits the existing child cleanup", async () => {
  const f = fixture();
  let calls = 0;
  let release!: () => void;
  f.adapters.stopOwned = async () => {
    calls++;
    if (calls === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  f.runtime.start();
  await tick();
  let stopped = false;
  const stop = f.runtime.stop().then(() => {
    stopped = true;
  });
  await tick();
  assert.equal(calls, 1);
  assert.equal(stopped, false);
  release();
  await stop;
  assert.equal(f.calls, 0);
  assert.equal(f.runtime.state(), "stopped");
});

test("closing during hung-child termination awaits that cleanup", async () => {
  const f = fixture();
  f.adapters.serviceOwned = () => false;
  f.setHealthy(true);
  f.runtime.start();
  await tick();
  f.adapters.probe = async () => ({
    health: null,
    childAlive: true,
    portOpen: true,
  });
  let release!: () => void;
  f.adapters.killOwned = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  for (let i = 0; i < 10 && !release; i++) {
    f.clock.increment(10);
    await tick();
  }
  assert.ok(release);
  let stopped = false;
  const stop = f.runtime.stop().then(() => {
    stopped = true;
  });
  await tick();
  assert.equal(stopped, false);
  release();
  await stop;
  assert.equal(f.runtime.state(), "stopped");
});
