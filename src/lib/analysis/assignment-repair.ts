import type { EvidenceAssignment, Task, TaskValue } from "@/types/analysis";
import { assertSchema } from "./schemas";
import { validateTask } from "./validation";

type AssignmentTask = Extract<Task, { kind: "assign" }>;

/** Retain only individually verified cells; missing/conflicting cells require the model. */
export function assignmentRepair(task: AssignmentTask) {
  const cells = new Map<string, EvidenceAssignment["assignments"][number]>();
  const key = (candidate: string, voc: string) =>
    JSON.stringify([candidate, voc]);
  return {
    accept(value: TaskValue) {
      assertSchema("assign", value);
      const results = (value as { results: EvidenceAssignment[] }).results;
      for (const target of task.input.targets) {
        const matches = results.filter((r) => r.candidateId === target.id);
        // Conflicting duplicate candidates must be re-evaluated, not arbitrarily chosen.
        if (matches.length !== 1) continue;
        const result = matches[0];
        for (const packet of task.input.packets) {
          const rows = result.assignments.filter(
            (a) => a.vocId === packet.vocId,
          );
          if (rows.length !== 1) continue;
          const single: AssignmentTask = {
            kind: "assign",
            input: { ...task.input, targets: [target], packets: [packet] },
          };
          try {
            validateTask(single, {
              results: [{ ...result, assignments: rows }],
            });
            if (!cells.has(key(target.id, packet.vocId)))
              cells.set(key(target.id, packet.vocId), structuredClone(rows[0]));
          } catch {
            /* Invalid evidence is retried, never replaced with a guessed stance. */
          }
        }
      }
      return {
        results: task.input.targets.map((target) => ({
          schemaVersion: "1.0.0" as const,
          snapshotId: task.input.snapshotId,
          batchId: task.input.batchId,
          candidateId: target.id,
          assignments: task.input.packets.flatMap((packet) => {
            const cell = cells.get(key(target.id, packet.vocId));
            return cell ? [cell] : [];
          }),
        })),
      };
    },
    remaining(): AssignmentTask {
      const targets = task.input.targets.filter((t) =>
        task.input.packets.some((p) => !cells.has(key(t.id, p.vocId))),
      );
      const packets = task.input.packets.filter((p) =>
        targets.some((t) => !cells.has(key(t.id, p.vocId))),
      );
      return { kind: "assign", input: { ...task.input, targets, packets } };
    },
  };
}
