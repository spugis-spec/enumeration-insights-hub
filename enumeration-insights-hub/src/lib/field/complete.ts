import { patchMany } from "./db";
import { activeAllocs, type DT, type Model } from "./data";

/** Marks DTs completed: closes their active allocations and sets the DT to Completed. Returns how many DTs changed. */
export async function completeDts(m: Model, list: DT[]): Promise<number> {
  const todo = list.filter((d) => d.status !== "completed");
  if (!todo.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const allocs = todo.flatMap((d) => activeAllocs(m, d.dt_id));
  await patchMany("allocations", allocs.map((a) => ({ id: a.id, patch: { status: "completed", completed_on: today } })));
  await patchMany("dts", todo.map((d) => ({ id: d.id, patch: { status: "completed", updated_at: now } })));
  return todo.length;
}
