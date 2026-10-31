import { useLiveQuery } from "@tanstack/react-db";
import { MessageSquareIcon, PlusIcon, RepeatIcon, SmartphoneIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { Schedule } from "assistant/schedule";
import { RepeatFields } from "@/components/repeat-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { scheduleCollection } from "@/lib/collections";
import { follow } from "@/lib/feedback";
import { planRepeat, type RepeatForm } from "@/lib/repeat";
import { formatRelative, formatWhen, phoneTimezone, toLocalInput } from "@/lib/time";
import { describeRecurrence, isCron, upcomingRuns } from "utils/recurrence";

/** Schedules the app adds; the chat's own are `schedule:<task id>`. */
const fromApp = (schedule: Schedule) => schedule.id.startsWith("schedule:owner:");

/** The instructions the assistant will carry out later, soonest first, whether set in the chat or here. */
export function SchedulesPanel() {
  const schedules = useLiveQuery((q) =>
    q.from({ schedule: scheduleCollection }).orderBy(({ schedule }) => schedule.runAt, "asc"),
  );

  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<Schedule | null>(null);

  if (schedules.isLoadingError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load schedules.</p>
    );
  }

  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      <Button className="h-10" onClick={() => setAdding(true)}>
        <PlusIcon />
        New schedule
      </Button>
      {schedules.data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-card">
          {schedules.data.map((schedule) => (
            <li key={schedule.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-1 px-3 py-2.5 text-left"
                onClick={() => setViewing(schedule)}
              >
                <p className="line-clamp-2 text-[0.95rem] leading-snug">{schedule.instruction}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>
                    {formatWhen(schedule.runAt)}
                    {formatRelative(schedule.runAt, now) !== "" &&
                      ` · ${formatRelative(schedule.runAt, now)}`}
                  </span>
                  {schedule.recurrence !== undefined && (
                    <span className="inline-flex items-center gap-1">
                      <RepeatIcon className="size-3" />
                      {describeRecurrence(schedule.recurrence)}
                    </span>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-1 text-xs text-muted-foreground">
        When one is due, the assistant carries it out in the chat, as if you had asked it then.
      </p>
      <AddSchedule open={adding} onClose={() => setAdding(false)} />
      <ViewSchedule schedule={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function AddSchedule({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>{open && <AddScheduleForm onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

const HOUR_MS = 60 * 60_000;

const initialRepeat = (now: number): RepeatForm => ({
  kind: "never",
  // The next whole hour, a common choice that is always in the future.
  at: toLocalInput(Math.ceil((now + 1) / HOUR_MS) * HOUR_MS),
  interval: "1",
  unit: "day",
  days: [1, 2, 3, 4, 5],
  time: "09:00",
  monthly: "day",
  monthDay: String(new Date(now).getDate()),
  nth: "1",
  weekday: "1",
  cron: "0 9 * * 1-5",
});

function AddScheduleForm({ onClose }: { readonly onClose: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [repeat, setRepeat] = useState(() => initialRepeat(Date.now()));
  const timezone = phoneTimezone();
  const plan = planRepeat(repeat, timezone, Date.now());
  const valid = instruction.trim() !== "" && plan.ok;

  const save = (event: FormEvent) => {
    event.preventDefault();

    if (!valid || !plan.ok) return;

    const once: Schedule = {
      id: `schedule:owner:${crypto.randomUUID()}`,
      instruction: instruction.trim(),
      runAt: plan.runAt,
    };

    follow(
      scheduleCollection.insert(
        plan.recurrence === undefined ? once : { ...once, recurrence: plan.recurrence },
      ),
    );
    onClose();
  };

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New schedule</DialogTitle>
        <DialogDescription>What the assistant should do, and when.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="schedule-instruction">Instruction</Label>
        <Textarea
          id="schedule-instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Remind me to water the plants"
          maxLength={100_000}
          rows={3}
          required
        />
      </div>
      <RepeatFields form={repeat} onChange={(changes) => setRepeat({ ...repeat, ...changes })} />
      <RunPreview plan={plan} timezone={timezone} />
      <DialogFooter>
        <Button type="submit" disabled={!valid}>
          Schedule
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The next runs the form would schedule, as the server will compute them; or why there are none. */
function RunPreview({
  plan,
  timezone,
}: {
  readonly plan: ReturnType<typeof planRepeat>;
  readonly timezone: string;
}) {
  if (!plan.ok) return <p className="text-xs text-destructive">{plan.error}</p>;

  if (plan.recurrence === undefined) return null;

  const runs = upcomingRuns(plan.recurrence, plan.runAt, 3);

  return (
    <div className="grid gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
      <p className="text-xs text-muted-foreground">
        {describeRecurrence(plan.recurrence)} · {timezone}
      </p>
      <ul className="grid gap-0.5">
        {runs.map((run) => (
          <li key={run}>{formatWhen(run)}</li>
        ))}
      </ul>
    </div>
  );
}

function ViewSchedule({
  schedule,
  onClose,
}: {
  readonly schedule: Schedule | null;
  readonly onClose: () => void;
}) {
  const cancel = (id: string) => {
    follow(scheduleCollection.delete(id));
    onClose();
  };

  return (
    <Dialog open={schedule !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {schedule !== null && (
          <>
            <DialogHeader>
              <DialogTitle>Scheduled</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5">
                {fromApp(schedule) ? (
                  <SmartphoneIcon className="size-3.5" />
                ) : (
                  <MessageSquareIcon className="size-3.5" />
                )}
                {fromApp(schedule) ? "Added here" : "Set in the chat"}
              </DialogDescription>
            </DialogHeader>
            <p className="text-[0.95rem] whitespace-pre-wrap">{schedule.instruction}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Next</dt>
              <dd>{formatWhen(schedule.runAt)}</dd>
              {schedule.recurrence !== undefined && (
                <>
                  <dt className="text-muted-foreground">Repeats</dt>
                  <dd>
                    {describeRecurrence(schedule.recurrence)} ({schedule.recurrence.timezone})
                  </dd>
                  {isCron(schedule.recurrence) && (
                    <>
                      <dt className="text-muted-foreground">Cron</dt>
                      <dd>
                        <code>{schedule.recurrence.cron}</code>
                      </dd>
                    </>
                  )}
                </>
              )}
            </dl>
            <DialogFooter>
              <Button variant="destructive" onClick={() => cancel(schedule.id)}>
                {schedule.recurrence === undefined ? "Cancel schedule" : "Cancel all repeats"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
