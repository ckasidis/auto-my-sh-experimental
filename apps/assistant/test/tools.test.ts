import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  Harness,
  MemoryStorage,
} from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import {
  createListSchedulesTool,
  createScheduleTool,
  DeliverScheduledInstruction,
} from "../src/schedule.ts";

describe("custom tools", () => {
  it("creates durable delayed tasks before requesting their Durable Object alarms", async () => {
    const context = BACKGROUND_CONTEXT;
    const at = new Date(Date.now() + 30 * 60_000).toISOString();

    const recurrence = {
      cadence: { unit: "day", interval: 1 },
      timezone: "Europe/Vienna",
    } as const;

    const faux = fauxProvider();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("schedule", { instruction: "Check the oven", at }),
          fauxToolCall("schedule", {
            instruction: "Look outside",
            delaySeconds: 5,
            recurrence,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Both are scheduled.")]),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    let harness: Harness;
    const tasksWhenCreated = new Map<number, unknown>();

    const scheduleTool = createScheduleTool(async (runAt) => {
      tasksWhenCreated.set(
        runAt,
        (await harness.inspect(context)).tasks
          .filter(({ record }) => record.kind === DeliverScheduledInstruction.definition.name)
          .map(({ record }) => record.input),
      );
    });

    registry.install(
      defineExtension({
        name: "schedule",
        tasks: [DeliverScheduledInstruction],
        tools: [scheduleTool],
      }),
    );
    harness = await Harness.open(new MemoryStorage(), { models, registry }, context);

    try {
      const root = await harness.root(context);
      await root.configure(
        { model: { provider: "faux", modelId: "faux-1" }, tools: [scheduleTool] },
        context,
      );

      const before = Date.now();
      const submission = await root.submit({ type: "input", content: "Remind me twice" }, context);
      await submission.wait(context);

      const tasks = (await harness.inspect(context)).tasks
        .filter(({ record }) => record.kind === DeliverScheduledInstruction.definition.name)
        .map(({ record }) => record);

      // SAFETY: the kind filter above leaves only delivery tasks, whose input is a `ScheduledInstruction`.
      const inputs = tasks.map(
        ({ input }) => input as { id: string; instruction: string; runAt: number },
      );

      expect(inputs).toEqual(
        expect.arrayContaining([
          {
            id: expect.stringMatching(/^schedule:\d+$/),
            conversationId: root.id,
            instruction: "Check the oven",
            runAt: Date.parse(at),
          },
          {
            id: expect.stringMatching(/^schedule:\d+$/),
            conversationId: root.id,
            instruction: "Look outside",
            runAt: expect.any(Number),
            recurrence,
          },
        ]),
      );
      const delayed = inputs.find(({ instruction }) => instruction === "Look outside")!;
      expect(delayed.runAt).toBeGreaterThanOrEqual(before + 5_000);
      expect(delayed.runAt).toBeLessThanOrEqual(Date.now() + 5_000);

      for (const input of inputs) {
        expect(tasksWhenCreated.get(input.runAt)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: input.id })]),
        );
      }

      expect(new Set(inputs.map(({ id }) => id)).size).toBe(2);
      expect(tasks.map(({ owner, background }) => ({ owner, background }))).toEqual([
        { owner: undefined, background: true },
        { owner: undefined, background: true },
      ]);
    } finally {
      await harness.close(context);
    }
  });

  it("rejects ambiguous or unusable schedule times without creating tasks", async () => {
    const context = BACKGROUND_CONTEXT;

    const calls: Array<Parameters<typeof fauxToolCall>[1]> = [
      { instruction: "Neither" },
      { instruction: "Both", delaySeconds: 5, at: new Date(Date.now() + 60_000).toISOString() },
      { instruction: "Local time", at: "2099-01-01T09:00:00" },
      {
        instruction: "Invalid timezone",
        delaySeconds: 5,
        recurrence: {
          cadence: { unit: "day", interval: 1 },
          timezone: "Mars/Olympus_Mons",
        },
      },
      { instruction: "Past", at: new Date(Date.now() - 60_000).toISOString() },
    ];

    const faux = fauxProvider();
    faux.setResponses([
      fauxAssistantMessage(
        calls.map((args, index) => fauxToolCall("schedule", args, { id: `call-${index}` })),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("None could be scheduled.")]),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    const scheduleTool = createScheduleTool(async () => {});
    registry.install(
      defineExtension({
        name: "schedule",
        tasks: [DeliverScheduledInstruction],
        tools: [scheduleTool],
      }),
    );
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);

    try {
      const root = await harness.root(context);
      await root.configure(
        { model: { provider: "faux", modelId: "faux-1" }, tools: [scheduleTool] },
        context,
      );

      await (
        await root.submit({ type: "input", content: "Schedule these" }, context)
      ).wait(context);

      const results = (await root.context(context)).messages.filter(
        (message) => message.role === "toolResult",
      );

      expect(results).toHaveLength(calls.length);
      expect(results.every((result) => result.isError)).toBe(true);
      expect(
        (await harness.inspect(context)).tasks.filter(
          ({ record }) => record.kind === DeliverScheduledInstruction.definition.name,
        ),
      ).toEqual([]);
    } finally {
      await harness.close(context);
    }
  });
  it("lists undelivered schedules soonest first", async () => {
    const context = BACKGROUND_CONTEXT;
    const at = new Date(Date.now() + 30 * 60_000).toISOString();

    const faux = fauxProvider();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("schedule", { instruction: "Check the oven", at }),
          fauxToolCall("schedule", {
            instruction: "Look outside",
            delaySeconds: 60,
            recurrence: { cadence: { unit: "day", interval: 1 }, timezone: "Asia/Singapore" },
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxToolCall("list_schedules", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Two are scheduled.")]),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    const tools = [createScheduleTool(async () => {}), createListSchedulesTool()];
    registry.install(
      defineExtension({ name: "schedule", tasks: [DeliverScheduledInstruction], tools }),
    );
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);

    try {
      const root = await harness.root(context);
      await root.configure({ model: { provider: "faux", modelId: "faux-1" }, tools }, context);
      await (
        await root.submit({ type: "input", content: "Schedule and list" }, context)
      ).wait(context);

      const listed = (await root.context(context)).messages
        .filter((message) => message.role === "toolResult")
        .at(-1)!;

      expect(listed.isError).toBe(false);
      expect(listed.content).toEqual([
        {
          type: "text",
          text: expect.stringMatching(
            new RegExp(
              `^- .+: "Look outside" \\(id: schedule:\\d+, every day in Asia/Singapore\\)\n- ${at.replaceAll(".", "\\.")}: "Check the oven" \\(id: schedule:\\d+\\)$`,
            ),
          ),
        },
      ]);
    } finally {
      await harness.close(context);
    }
  });
});
