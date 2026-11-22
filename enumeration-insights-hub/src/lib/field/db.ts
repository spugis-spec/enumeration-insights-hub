import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

/** Firestore doc IDs can't contain "/". */
export const safeId = (s: string) => s.trim().replace(/\//g, "_").replace(/^\.+$/, "_") || "_";

export async function listAll<T>(col: string): Promise<T[]> {
  const snap = await getDocs(collection(db(), col));
  return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T);
}

export async function addRow(col: string, data: Record<string, any>) {
  const r = await addDoc(collection(db(), col), { ...data, created_at: new Date().toISOString() });
  return r.id;
}

export async function updateRow(col: string, id: string, patch: Record<string, any>) {
  await updateDoc(doc(db(), col, id), patch);
}

export async function removeRow(col: string, id: string) {
  await deleteDoc(doc(db(), col, id));
}

/** Batched merge-upsert. idOf returns the document ID (or null for an auto ID). */
export type Progress = (done: number, total: number) => void;

export async function upsertMany(col: string, rows: Record<string, any>[], idOf: (r: any) => string | null, onProgress?: Progress) {
  const c = collection(db(), col);
  onProgress?.(0, rows.length);
  for (let i = 0; i < rows.length; i += 450) {
    const b = writeBatch(db());
    for (const r of rows.slice(i, i + 450)) {
      const id = idOf(r);
      b.set(id ? doc(c, safeId(id)) : doc(c), r, { merge: true });
    }
    await b.commit();
    onProgress?.(Math.min(i + 450, rows.length), rows.length);
  }
}

export async function clearCollection(col: string, onProgress?: Progress) {
  onProgress?.(0, 0);
  const snap = await getDocs(collection(db(), col));
  onProgress?.(0, snap.size);
  for (let i = 0; i < snap.docs.length; i += 450) {
    const b = writeBatch(db());
    for (const d of snap.docs.slice(i, i + 450)) b.delete(d.ref);
    await b.commit();
    onProgress?.(Math.min(i + 450, snap.size), snap.size);
  }
  return snap.size;
}

/** Delete specific documents by ID. */
export async function removeMany(col: string, ids: string[], onProgress?: Progress) {
  onProgress?.(0, ids.length);
  for (let i = 0; i < ids.length; i += 450) {
    const b = writeBatch(db());
    for (const id of ids.slice(i, i + 450)) b.delete(doc(db(), col, id));
    await b.commit();
    onProgress?.(Math.min(i + 450, ids.length), ids.length);
  }
  return ids.length;
}

/** Write rows back using their own `id` as the document ID (used by restore). */
export async function setMany(col: string, rows: Record<string, any>[], onProgress?: Progress) {
  const c = collection(db(), col);
  onProgress?.(0, rows.length);
  for (let i = 0; i < rows.length; i += 450) {
    const b = writeBatch(db());
    for (const r of rows.slice(i, i + 450)) {
      const { id, ...rest } = r;
      b.set(id ? doc(c, String(id)) : doc(c), rest);
    }
    await b.commit();
    onProgress?.(Math.min(i + 450, rows.length), rows.length);
  }
  return rows.length;
}

/** Set one field to null on every doc in a collection. */
export async function nullField(col: string, field: string) {
  const snap = await getDocs(collection(db(), col));
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 450) {
    const b = writeBatch(db());
    for (const d of snap.docs.slice(i, i + 450)) { if (d.get(field) != null) { b.update(d.ref, { [field]: null }); n++; } }
    await b.commit();
  }
  return n;
}

export async function deleteWhere(col: string, field: string, value: string) {
  const snap = await getDocs(query(collection(db(), col), where(field, "==", value)));
  for (let i = 0; i < snap.docs.length; i += 450) {
    const b = writeBatch(db());
    for (const d of snap.docs.slice(i, i + 450)) b.delete(d.ref);
    await b.commit();
  }
  return snap.size;
}

export async function listWhere<T>(col: string, field: string, value: string): Promise<T[]> {
  const snap = await getDocs(query(collection(db(), col), where(field, "==", value)));
  return snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T);
}

export async function addMany(col: string, rows: Record<string, any>[], onProgress?: Progress) {
  const c = collection(db(), col);
  const now = new Date().toISOString();
  onProgress?.(0, rows.length);
  for (let i = 0; i < rows.length; i += 450) {
    const b = writeBatch(db());
    for (const r of rows.slice(i, i + 450)) b.set(doc(c), { ...r, created_at: now });
    await b.commit();
    onProgress?.(Math.min(i + 450, rows.length), rows.length);
  }
  return rows.length;
}

export async function patchMany(col: string, patches: { id: string; patch: Record<string, any> }[]) {
  for (let i = 0; i < patches.length; i += 450) {
    const b = writeBatch(db());
    for (const p of patches.slice(i, i + 450)) b.update(doc(db(), col, p.id), p.patch);
    await b.commit();
  }
  return patches.length;
}
