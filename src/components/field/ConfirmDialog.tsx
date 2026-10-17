import { useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ConfirmReq = {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** If set, the person must type this word to enable the button. */
  typeToConfirm?: string;
  danger?: boolean;
  /** Optional second action button, e.g. "Assign and lock feeders". */
  alt?: { label: string; onClick: () => unknown };
  cancelLabel?: string;
  onConfirm: () => unknown;
};

export function ConfirmDialog({ req, onClose }: { req: ConfirmReq | null; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const close = () => { setTyped(""); onClose(); };
  const ok = !req?.typeToConfirm || typed.trim().toUpperCase() === req.typeToConfirm.toUpperCase();
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) close(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild><div className="space-y-2 text-sm">{req?.body}</div></AlertDialogDescription>
        </AlertDialogHeader>
        {req?.typeToConfirm && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Type <b>{req.typeToConfirm}</b> to confirm</div>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setTyped("")}>{req?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          {req?.alt && <Button variant="outline" onClick={async () => { const r = req; close(); await r?.alt?.onClick(); }}>{req.alt.label}</Button>}
          <Button variant={req?.danger ? "destructive" : "default"} disabled={!ok} onClick={async () => { const r = req; close(); await r?.onConfirm(); }}>
            {req?.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Small helper: const { ask, dialog } = useConfirm();  ...  ask({...}); ...  return <>{...}{dialog}</> */
export function useConfirm() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  return { ask: (r: ConfirmReq) => setReq(r), dialog: <ConfirmDialog req={req} onClose={() => setReq(null)} /> };
}
