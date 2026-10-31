import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTask,
  type Harness,
  type TaskId,
  type ToolRegistration,
  type Tx,
} from "@earendil-works/pi-durable";
import {
  copyRecurrence,
  describeRecurrence,
  firstCronRunAt,
  type IntervalRecurrence,
  isCron,
  nextRunAt,
  type ScheduleRecurrence,
  validateRecurrence,
} from "utils/recurrence";
import { parseOffsetDateTime } from "./lib/time.ts";

/** A scheduled instruction still to be delivered to the chat. */
export type Schedule = {
  readonly id: string;
  readonly instruction: string;
  /** Unix timestamp in milliseconds. */
  readonly runAt: number;
  readonly recurrence?: ScheduleRecurrence;
};

/**
 * A schedule the owner sets directly, without the model. The caller chooses its id (`schedule:owner:<key>`), so a
 * retried add is the same schedule while it is still to be delivered.
 */
export type ScheduleRequest = {
  readonly id: string;
  readonly instruction: string;
  /**
   * ISO 8601 date-time with a timezone offset, in the future: the run, or the first of a recurrence. Optional for a cron
   * recurrence, whose first run is its first match from this time, or from now when it is absent.
   */
  readonly at?: string;
  readonly recurrence?: ScheduleRecurrence;
};

/** Durable input of one scheduled delivery. */
type ScheduledInstruction = Schedule & {
  readonly conversationId: ConversationId;
};

type DeliveryState = { phase: "wait" } | { phase: "deliver" };

const MAX_PROMPT_CHARACTERS = 100_000;
const SCHEDULED_INSTRUCTION_PREFIX = "Scheduled instruction due now: ";
const RECURRENCE_NOTE_PREFIX = "\n\nThis instruction recurs.";

/** "every 2 days in Asia/Singapore", "cron 0 9 * * 1-5 (At 09:00, Monday through Friday) in Asia/Singapore". */
function recurrenceLabel(recurrence: ScheduleRecurrence): string {
  const described = describeRecurrence(recurrence);

  const label = isCron(recurrence)
    ? `cron ${recurrence.cron} (${described})`
    : described.charAt(0).toLowerCase() + described.slice(1);

  return `${label} in ${recurrence.timezone}`;
}

/** Input submitted when a scheduled instruction is due. Self-contained; no system-prompt support needed. */
export function formatScheduledInstruction(
  scheduled: Pick<ScheduledInstruction, "id" | "instruction" | "recurrence">,
): string {
  const text = `${SCHEDULED_INSTRUCTION_PREFIX}${scheduled.instruction}`;

  if (scheduled.recurrence === undefined) return text;

  return `${text}${RECURRENCE_NOTE_PREFIX} It repeats: ${recurrenceLabel(scheduled.recurrence)}. After carrying it out, call schedule with this instruction and sourceScheduleId ${JSON.stringify(scheduled.id)}. Omit delaySeconds, at, and recurrence because the next UTC deadline and recurrence policy are derived from the source.`;
}

/** Deliveries currently running, so `schedule` can reject accidental recursion. */
export const ScheduleDeliveries = defineDoc<{
  active: Array<{
    scheduleId: string;
    conversationId: ConversationId;
    instruction: string;
    runAt: number;
    recurrence?: ScheduleRecurrence;
    successor?: ScheduledInstruction;
  }>;
}>({
  kind: "app.schedule-deliveries",
  version: 1,
  scope: "session",
  initial: () => ({ active: [] }),
  checkpointWhen: () => true,
});

export const DeliverScheduledInstruction = defineTask<ScheduledInstruction, DeliveryState, null>({
  name: "app.deliver-scheduled-instruction",
  version: 1,
  initial: () => ({ phase: "wait" }),
  phases: {
    wait: async (task, runtime, context) => {
      // pi-durable 1.4 replaced the in-phase `runtime.sleep()` with a committed sleep that resumes this phase.
      if (runtime.now() < task.input.runAt) {
        await runtime.sleepUntil(task.input.runAt, { phase: "wait" }, context);

        return;
      }

      await runtime.commit(async (tx) => {
        const deliveries = await tx.doc(ScheduleDeliveries);

        if (!deliveries.active.some(({ scheduleId }) => scheduleId === task.input.id)) {
          const delivery: (typeof deliveries.active)[number] = {
            scheduleId: task.input.id,
            conversationId: task.input.conversationId,
            instruction: task.input.instruction,
            runAt: task.input.runAt,
          };

          if (task.input.recurrence !== undefined) delivery.recurrence = task.input.recurrence;

          deliveries.active.push(delivery);
        }

        return { status: "running", checkpoint: { phase: "deliver" } };
      }, context);
    },
    deliver: async (task, runtime, context) => {
      try {
        const conversation = await runtime.conversation(task.input.conversationId, context);

        if (conversation !== undefined) {
          const submission = await conversation.submit(
            {
              type: "input",
              content: formatScheduledInstruction(task.input),
              requestId: task.input.id,
              whenBusy: "followUp",
            },
            context,
          );

          await submission.wait(context);
        } else {
          runtime.report(
            new Error(
              `Scheduled instruction ${task.input.id} conversation ${task.input.conversationId} is missing`,
            ),
          );
        }
      } finally {
        await runtime.commit(async (tx) => {
          removeDelivery(await tx.doc(ScheduleDeliveries), task.input.id);

          return { status: "running", checkpoint: { phase: "deliver" } };
        }, context);
      }

      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
        context,
      );
    },
  },
  abort: async (task, runtime, context) => {
    await runtime.commit(async (tx) => {
      removeDelivery(await tx.doc(ScheduleDeliveries), task.input.id);

      return { status: "terminal", outcome: { status: "aborted" } };
    }, context);
  },
});

const removeDelivery = (
  deliveries: { active: Array<{ scheduleId: string }> },
  scheduleId: string,
): void => {
  const index = deliveries.active.findIndex((delivery) => delivery.scheduleId === scheduleId);

  if (index !== -1) deliveries.active.splice(index, 1);
};

const MAX_DELAY_SECONDS = 366 * 24 * 60 * 60;

/** The schedule a tool task created, so a safe replay returns it instead of creating another. */
const ScheduleIntent = defineDoc<{ scheduled?: ScheduledInstruction }>({
  kind: "app.schedule-intent",
  version: 1,
  scope: "task",
  initial: () => ({}),
  checkpointWhen: () => true,
});

/** The tool's recurrence: flat, with exactly one of `cadence` or `cron`, which models fill in more reliably than a union. */
type RecurrenceArguments = {
  readonly cadence?: IntervalRecurrence["cadence"];
  readonly cron?: string;
  readonly timezone: string;
};

type ScheduleArguments = {
  readonly instruction: string;
  readonly delaySeconds?: number;
  readonly at?: string;
  readonly recurrence?: RecurrenceArguments;
  readonly sourceScheduleId?: string;
};

/** The recurrence the tool's arguments describe, checked; undefined for a one-time schedule. */
function parseRecurrence(
  recurrence: RecurrenceArguments | undefined,
): ScheduleRecurrence | undefined {
  if (recurrence === undefined) return undefined;

  const { cadence, cron, timezone } = recurrence;

  if ((cadence === undefined) === (cron === undefined)) {
    throw new Error("recurrence needs exactly one of cadence or cron");
  }

  const parsed: ScheduleRecurrence =
    cron === undefined ? { cadence: cadence!, timezone } : { cron, timezone };

  validateRecurrence(parsed);

  return parsed;
}

/**
 * The first run: the time given, or for a cron recurrence the first match from it (from now when none is given). An
 * absolute time must be in the future, within a year.
 */
function resolveRunAt(
  { delaySeconds, at }: Pick<ScheduleArguments, "delaySeconds" | "at">,
  recurrence: ScheduleRecurrence | undefined,
  now: number,
): number {
  const cron = recurrence !== undefined && isCron(recurrence) ? recurrence : undefined;

  if (delaySeconds !== undefined && at !== undefined) {
    throw new Error("Provide at most one of delaySeconds or at");
  }

  if (cron === undefined && delaySeconds === undefined && at === undefined) {
    throw new Error("Provide exactly one of delaySeconds or at");
  }

  let from = now;

  if (delaySeconds !== undefined) from = now + delaySeconds * 1000;

  if (at !== undefined) {
    const time = parseOffsetDateTime(at);

    if (time === null) throw new Error("at must be an ISO 8601 date-time with a timezone offset");

    if (time <= now) throw new Error("at must be in the future");

    from = time;
  }

  const runAt = cron === undefined ? from : firstCronRunAt(cron, Math.max(from, now + 1));

  if (runAt === null) throw new Error(`${JSON.stringify(cron!.cron)} never runs`);

  if (runAt > now + MAX_DELAY_SECONDS * 1000)
    throw new Error("the first run is too far in the future");

  return runAt;
}

function copyScheduledInstruction(scheduled: ScheduledInstruction): ScheduledInstruction {
  const copy: ScheduledInstruction = {
    id: scheduled.id,
    conversationId: scheduled.conversationId,
    instruction: scheduled.instruction,
    runAt: scheduled.runAt,
  };

  if (scheduled.recurrence === undefined) return copy;

  return { ...copy, recurrence: copyRecurrence(scheduled.recurrence) };
}

const scheduleResult = (scheduled: ScheduledInstruction, now: number) => {
  const runAt = new Date(scheduled.runAt).toISOString();
  const seconds = Math.max(0, Math.round((scheduled.runAt - now) / 1000));
  const details = { id: scheduled.id, instruction: scheduled.instruction, runAt };

  return {
    output: [
      {
        type: "text" as const,
        text: `Scheduled. At ${runAt} (in ${seconds} seconds) this conversation will receive: ${JSON.stringify(scheduled.instruction)}. Nothing further is needed now.`,
      },
    ],
    details:
      scheduled.recurrence === undefined
        ? details
        : { ...details, recurrence: scheduled.recurrence },
  };
};

/**
 * `ensureWakeupAt` is a test seam: under `PiHarness`, pi's `onWake` already arms the Durable Object alarm for the
 * delivery task's sleep, so production needs nothing here.
 */
export function createScheduleTool(
  ensureWakeupAt: (timestamp: number) => Promise<void> = async () => {},
): ToolRegistration {
  return {
    name: "schedule",
    description:
      "Schedule an instruction to be delivered to this conversation at a later time, such as reminding the owner of something. The conversation resumes then with the instruction as its input and carries it out with its normal tools. Use this whenever the owner wants something to happen or be said later; scheduling is the complete response to such a request. Not for deadlines: a todo's due date is set with add_todo or update_todo and does nothing on its own.",
    parameters: Type.Object({
      instruction: Type.String({
        minLength: 1,
        maxLength: MAX_PROMPT_CHARACTERS,
        description:
          "What to do when the schedule fires, phrased as a self-contained request without timing words, e.g. 'Check the weather in London'",
      }),
      delaySeconds: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_DELAY_SECONDS,
          description:
            "Run after this many seconds. Use for relative times such as 'in 10 minutes'",
        }),
      ),
      at: Type.Optional(
        Type.String({
          description:
            "Run at this ISO 8601 date-time with a timezone offset, e.g. 2026-10-01T09:00:00+02:00. Use for absolute times; provide exactly one of delaySeconds or at, unless recurrence.cron sets the times",
        }),
      ),
      recurrence: Type.Optional(
        Type.Object({
          cadence: Type.Optional(
            Type.Object(
              {
                unit: Type.Union([
                  Type.Literal("minute"),
                  Type.Literal("hour"),
                  Type.Literal("day"),
                  Type.Literal("week"),
                  Type.Literal("month"),
                ]),
                interval: Type.Integer({ minimum: 1, maximum: 10_000 }),
              },
              { description: "Every N units, counted from the first run" },
            ),
          ),
          cron: Type.Optional(
            Type.String({
              minLength: 9,
              maxLength: 200,
              description:
                "Calendar recurrence as a five-field cron expression (minute hour day month weekday), e.g. '0 9 * * 1-5' for weekdays at 09:00, '0 18 L * *' for the last day of each month at 18:00, '0 9 * * 2#2' for the second Tuesday. Use instead of cadence for weekdays, specific days, or days of the month; delaySeconds and at may then be omitted, and the first run is the first match",
            }),
          ),
          timezone: Type.String({
            minLength: 1,
            maxLength: 100,
            description: "IANA timezone, e.g. Europe/Vienna or America/New_York",
          }),
        }),
      ),
      sourceScheduleId: Type.Optional(
        Type.String({
          description:
            "When scheduling the next occurrence of a recurring instruction, the schedule ID given in its delivery. Omit delaySeconds, at, and recurrence because the source determines them",
        }),
      ),
    }),
    replay: "safe",
    execute: async (args: ScheduleArguments, api, context) => {
      const existing = (await api.snapshot(ScheduleIntent, api.taskId, context))?.scheduled;

      if (existing !== undefined) {
        await ensureWakeupAt(existing.runAt);

        return scheduleResult(existing, Date.now());
      }

      const now = Date.now();
      let persisted: ScheduledInstruction;

      if (args.sourceScheduleId !== undefined) {
        if (
          args.delaySeconds !== undefined ||
          args.at !== undefined ||
          args.recurrence !== undefined
        ) {
          throw new Error(
            "A recurring successor derives its deadline and recurrence from sourceScheduleId; omit delaySeconds, at, and recurrence",
          );
        }

        persisted = await api.commit(async (tx) => {
          const deliveries = await tx.doc(ScheduleDeliveries);

          const source = deliveries.active.find(
            (delivery) =>
              delivery.conversationId === api.conversationId &&
              delivery.scheduleId === args.sourceScheduleId,
          );

          if (source === undefined) {
            throw new Error("sourceScheduleId does not identify an active scheduled delivery");
          }

          if (source.recurrence === undefined) {
            throw new Error("the source schedule has no structured recurrence policy");
          }

          if (source.successor !== undefined) return copyScheduledInstruction(source.successor);

          const sourceRecurrence = copyRecurrence(source.recurrence);

          const scheduled: ScheduledInstruction = {
            id: `schedule:${api.taskId}`,
            conversationId: api.conversationId,
            instruction: source.instruction,
            runAt: nextRunAt(sourceRecurrence, source.runAt, now),
            recurrence: sourceRecurrence,
          };

          source.successor = scheduled;
          await tx.createTask(DeliverScheduledInstruction, scheduled, {
            ownership: { kind: "conversation" },
            conversationId: api.conversationId,
            background: true,
          });

          return scheduled;
        }, context);
      } else {
        const recurrence = parseRecurrence(args.recurrence);

        const oneTime: ScheduledInstruction = {
          id: `schedule:${api.taskId}`,
          conversationId: api.conversationId,
          instruction: args.instruction,
          runAt: resolveRunAt(args, recurrence, now),
        };

        const requested = recurrence === undefined ? oneTime : { ...oneTime, recurrence };

        const deliveries = await api.snapshot(ScheduleDeliveries, context);

        if (
          deliveries?.active.some(({ conversationId }) => conversationId === api.conversationId) ===
          true
        ) {
          throw new Error(
            "schedule may run during a scheduled delivery only to create its recurring successor",
          );
        }

        persisted = await api.commit(async (tx) => {
          const intent = await tx.doc(ScheduleIntent, api.taskId);

          if (intent.scheduled !== undefined) return intent.scheduled;
          intent.scheduled = requested;
          await tx.createTask(DeliverScheduledInstruction, requested, {
            ownership: { kind: "conversation" },
            conversationId: api.conversationId,
            background: true,
          });

          return requested;
        }, context);
      }

      await ensureWakeupAt(persisted.runAt);

      return scheduleResult(persisted, now);
    },
  };
}

/** Delivery task states that have not settled: due later, delivering now, or about to start. */
const LIVE_STATUSES = ["pending", "running", "waiting", "sleeping"] as const;

const SCAN_PAGE_SIZE = 100;

const formatSchedule = (scheduled: ScheduledInstruction): string => {
  const runAt = new Date(scheduled.runAt).toISOString();

  if (scheduled.recurrence === undefined) {
    return `- ${runAt}: ${JSON.stringify(scheduled.instruction)} (id: ${scheduled.id})`;
  }

  return `- ${runAt}: ${JSON.stringify(scheduled.instruction)} (id: ${scheduled.id}, ${recurrenceLabel(scheduled.recurrence)})`;
};

/** A scheduled instruction still to be delivered, with the delivery task that carries it. */
type LiveSchedule = {
  readonly taskId: TaskId;
  readonly scheduled: ScheduledInstruction;
};

/** A conversation's scheduled instructions that have not been delivered or cancelled yet, soonest first. */
async function scanLiveSchedules(tx: Tx, conversationId: ConversationId): Promise<LiveSchedule[]> {
  const found: LiveSchedule[] = [];

  for (const status of LIVE_STATUSES) {
    let cursor: Parameters<typeof tx.scanTasks>[2];

    do {
      const page = await tx.scanTasks(
        {
          conversationId,
          kind: DeliverScheduledInstruction.definition.name,
          status,
          abortRequested: false,
        },
        SCAN_PAGE_SIZE,
        cursor,
      );

      for (const { id, input } of page.items) {
        // SAFETY: the kind filter leaves only delivery tasks, whose input is a `ScheduledInstruction`.
        found.push({ taskId: id, scheduled: input as ScheduledInstruction });
      }

      cursor = page.next;
    } while (cursor !== undefined);
  }

  return found.sort((left, right) => left.scheduled.runAt - right.scheduled.runAt);
}

/** Lists this conversation's scheduled instructions that have not been delivered yet, soonest first. */
export function createListSchedulesTool(): ToolRegistration {
  return {
    name: "list_schedules",
    description:
      "List this conversation's scheduled instructions (reminders and other things set to happen later) that are still to be delivered, soonest first, with each one's next UTC time, recurrence, and schedule ID. Todos and their due dates are listed by list_todos.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api, context) => {
      const scheduled = (
        await api.commit((tx) => scanLiveSchedules(tx, api.conversationId), context)
      ).map((live) => live.scheduled);

      const text =
        scheduled.length === 0
          ? "No scheduled instructions."
          : scheduled.map(formatSchedule).join("\n");

      return {
        output: [{ type: "text", text }],
        details: scheduled.map((item) => ({ ...item, runAt: new Date(item.runAt).toISOString() })),
      };
    },
  };
}

/** Schedule ids the owner chooses are kept apart from the `schedule:<task id>` ones the tool derives. */
const OWNER_SCHEDULE_ID = /^schedule:owner:[\w-]{1,100}$/;

const plainSchedule = ({ scheduled }: LiveSchedule): Schedule => {
  const { conversationId: _conversationId, ...schedule } = copyScheduledInstruction(scheduled);

  return schedule;
};

/** The root conversation's scheduled instructions still to be delivered, soonest first. */
export async function listSchedules(pi: Harness, context: Context): Promise<Schedule[]> {
  const root = await pi.root(context);
  const live = await root.commit((tx) => scanLiveSchedules(tx, root.id), context);

  return live.map(plainSchedule);
}

/**
 * Schedules an instruction in the root conversation, as the `schedule` tool does: when it is due, the conversation
 * receives it and the assistant carries it out. A recurring one is renewed by the assistant after each delivery.
 */
export async function addSchedule(
  pi: Harness,
  request: ScheduleRequest,
  context: Context,
): Promise<Schedule> {
  if (!OWNER_SCHEDULE_ID.test(request.id)) {
    throw new Error("id must be schedule:owner: followed by up to 100 letters, digits, _ or -");
  }

  const instruction = request.instruction.trim();

  if (instruction.length === 0 || instruction.length > MAX_PROMPT_CHARACTERS) {
    throw new Error(`instruction must have 1 to ${MAX_PROMPT_CHARACTERS} characters`);
  }

  const root = await pi.root(context);

  const recurrence =
    request.recurrence === undefined ? undefined : copyRecurrence(request.recurrence);

  if (recurrence !== undefined) validateRecurrence(recurrence);

  const oneTime: ScheduledInstruction = {
    id: request.id,
    conversationId: root.id,
    instruction,
    runAt: resolveRunAt({ at: request.at }, recurrence, Date.now()),
  };

  const requested = recurrence === undefined ? oneTime : { ...oneTime, recurrence };

  const live = await root.commit(async (tx) => {
    const existing = (await scanLiveSchedules(tx, root.id)).find(
      ({ scheduled }) => scheduled.id === request.id,
    );

    if (existing !== undefined) return existing;

    const taskId = await tx.createTask(DeliverScheduledInstruction, requested, {
      ownership: { kind: "conversation" },
      conversationId: root.id,
      background: true,
    });

    return { taskId, scheduled: requested };
  }, context);

  return plainSchedule(live);
}

/**
 * Cancels a scheduled instruction still to be delivered; false when none has this id. Cancelling a recurring one ends
 * the series, unless its delivery is running and has already scheduled the next one.
 */
export async function cancelSchedule(pi: Harness, id: string, context: Context): Promise<boolean> {
  const root = await pi.root(context);

  const live = (await root.commit((tx) => scanLiveSchedules(tx, root.id), context)).find(
    ({ scheduled }) => scheduled.id === id,
  );

  if (live === undefined) return false;

  // The abort is only marked here; its handler then settles the task, so wait for it to end.
  if ((await pi.abortTask(live.taskId, context)) === "marked") {
    await pi.waitForTask(live.taskId, context);
  }

  return true;
}

/** Instructions the assistant carries out later in the conversation that set them: the tools and the delivery task. */
export const schedulesExtension = defineExtension({
  name: "schedules",
  tasks: [DeliverScheduledInstruction],
  tools: [createScheduleTool(), createListSchedulesTool()],
});
