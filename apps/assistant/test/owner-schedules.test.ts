import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  defineExtension,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import {
  addSchedule,
  cancelSchedule,
  DeliverScheduledInstruction,
  listSchedules,
} from "../src/schedule.ts";

const context = BACKGROUND_CONTEXT;

const openHarness = async (): Promise<Harness> => {
  const registry = createRegistry();
  registry.install(defineExtension({ name: "schedule", tasks: [DeliverScheduledInstruction] }));

  return Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
};

describe("schedules set by the owner", () => {
  it("adds, lists soonest first, and cancels without the model", async () => {
    const harness = await openHarness();
    const later = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const sooner = new Date(Date.now() + 60 * 60_000).toISOString();

    const recurrence = {
      cadence: { unit: "day", interval: 1 },
      timezone: "Asia/Singapore",
    } as const;

    try {
      const added = await addSchedule(
        harness,
        { id: "schedule:owner:water", instruction: " Water the plants ", at: later, recurrence },
        context,
      );

      expect(added).toEqual({
        id: "schedule:owner:water",
        instruction: "Water the plants",
        runAt: Date.parse(later),
        recurrence,
      });

      await addSchedule(
        harness,
        { id: "schedule:owner:oven", instruction: "Check the oven", at: sooner },
        context,
      );

      // A retried add is the same schedule.
      await addSchedule(
        harness,
        { id: "schedule:owner:water", instruction: "Water the plants", at: later, recurrence },
        context,
      );

      expect((await listSchedules(harness, context)).map(({ id }) => id)).toEqual([
        "schedule:owner:oven",
        "schedule:owner:water",
      ]);

      expect(await cancelSchedule(harness, "schedule:owner:oven", context)).toBe(true);
      expect(await cancelSchedule(harness, "schedule:owner:oven", context)).toBe(false);
      expect((await listSchedules(harness, context)).map(({ id }) => id)).toEqual([
        "schedule:owner:water",
      ]);
    } finally {
      await harness.close(context);
    }
  });

  it("starts a cron schedule at its first match when no time is given", async () => {
    const harness = await openHarness();
    const recurrence = { cron: "0 9 * * 1-5", timezone: "Asia/Singapore" };

    try {
      const added = await addSchedule(
        harness,
        { id: "schedule:owner:standup", instruction: "Post the standup", recurrence },
        context,
      );

      expect(added.recurrence).toEqual(recurrence);
      expect(added.runAt).toBeGreaterThan(Date.now());
      // 09:00 in Singapore is 01:00 UTC, on a weekday.
      expect(new Date(added.runAt).getUTCHours()).toBe(1);
      expect([0, 6]).not.toContain(new Date(added.runAt).getUTCDay());
      expect(await listSchedules(harness, context)).toEqual([added]);
    } finally {
      await harness.close(context);
    }
  });

  it("rejects ids, instructions and times the tool would not accept", async () => {
    const harness = await openHarness();
    const at = new Date(Date.now() + 60_000).toISOString();

    try {
      await expect(
        addSchedule(harness, { id: "schedule:1", instruction: "Tool id", at }, context),
      ).rejects.toThrow("id must be");
      await expect(
        addSchedule(harness, { id: "schedule:owner:a", instruction: "  ", at }, context),
      ).rejects.toThrow("instruction must have");
      await expect(
        addSchedule(
          harness,
          { id: "schedule:owner:b", instruction: "Local", at: "2099-01-01T09:00:00" },
          context,
        ),
      ).rejects.toThrow("timezone offset");
      await expect(
        addSchedule(
          harness,
          { id: "schedule:owner:c", instruction: "Past", at: new Date(0).toISOString() },
          context,
        ),
      ).rejects.toThrow("in the future");
      await expect(
        addSchedule(harness, { id: "schedule:owner:d", instruction: "No time" }, context),
      ).rejects.toThrow("exactly one of");
      await expect(
        addSchedule(
          harness,
          {
            id: "schedule:owner:e",
            instruction: "Every second",
            recurrence: { cron: "* * * * * *", timezone: "UTC" },
          },
          context,
        ),
      ).rejects.toThrow("five-field");
      expect(await listSchedules(harness, context)).toEqual([]);
    } finally {
      await harness.close(context);
    }
  });
});
