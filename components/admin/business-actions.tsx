"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldOff, ShieldCheck, Trash2 } from "lucide-react";
import { suspendBusinessAction, reactivateBusinessAction, deleteBusinessAction } from "@/app/actions/business-lifecycle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface BusinessActionsProps {
  businessId: string;
  businessName: string;
  isSuspended: boolean;
}

export function BusinessActions({ businessId, businessName, isSuspended }: BusinessActionsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // ---- Suspend ----
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  function handleSuspend() {
    setSuspending(true);
    setSuspendError(null);
    startTransition(async () => {
      const result = await suspendBusinessAction(businessId, suspendReason);
      setSuspending(false);
      if (!result.success) {
        setSuspendError(result.error || "Could not suspend this business.");
        return;
      }
      setSuspendOpen(false);
      setSuspendReason("");
      router.refresh();
    });
  }

  // ---- Reactivate ----
  const [reactivating, setReactivating] = useState(false);

  function handleReactivate() {
    setReactivating(true);
    startTransition(async () => {
      await reactivateBusinessAction(businessId);
      setReactivating(false);
      router.refresh();
    });
  }

  // ---- Delete ----
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteBusinessAction(businessId, typedName);
      setDeleting(false);
      if (!result.success) {
        setDeleteError(result.error || "Could not delete this business.");
        return;
      }
      router.push("/admin");
    });
  }

  return (
    <div className="flex items-center gap-2">
      {isSuspended ? (
        <Button variant="outline" size="sm" onClick={handleReactivate} disabled={reactivating}>
          <ShieldCheck className="h-3.5 w-3.5" /> {reactivating ? "Reactivating…" : "Reactivate"}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setSuspendOpen(true)}>
          <ShieldOff className="h-3.5 w-3.5" /> Suspend
        </Button>
      )}
      <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </Button>

      {/* Suspend dialog */}
      <Dialog open={suspendOpen} onOpenChange={(open) => !open && setSuspendOpen(false)}>
        <DialogContent>
          <DialogTitle className="font-display text-[17px] font-semibold text-ink">Suspend {businessName}?</DialogTitle>
          <DialogDescription className="mt-2 text-[13px] text-text-muted">
            This immediately turns off their AI receptionist — their phone will stop being answered by AI until you reactivate them. This does not affect their billing.
          </DialogDescription>
          <div className="mt-4">
            <Label>Reason (for your own records)</Label>
            <Textarea rows={2} className="mt-1.5" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
          </div>
          {suspendError && <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{suspendError}</div>}
          <div className="mt-5 flex gap-2">
            <Button variant="danger" onClick={handleSuspend} disabled={suspending}>{suspending ? "Suspending…" : "Yes, suspend this business"}</Button>
            <Button variant="outline" onClick={() => setSuspendOpen(false)} disabled={suspending}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete dialog - requires typing the exact business name */}
      <Dialog open={deleteOpen} onOpenChange={(open) => !open && setDeleteOpen(false)}>
        <DialogContent>
          <DialogTitle className="font-display text-[17px] font-semibold text-danger">Permanently delete {businessName}?</DialogTitle>
          <DialogDescription className="mt-2 text-[13px] text-text-muted">
            This permanently deletes this business and everything tied to it — calls, transcripts, orders, and customers. This cannot be undone.
          </DialogDescription>
          <div className="mt-4">
            <Label>Type <span className="font-mono font-semibold text-text">{businessName}</span> to confirm</Label>
            <Input className="mt-1.5" value={typedName} onChange={(e) => setTypedName(e.target.value)} />
          </div>
          {deleteError && <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{deleteError}</div>}
          <div className="mt-5 flex gap-2">
            <Button variant="danger" onClick={handleDelete} disabled={deleting || typedName.trim() !== businessName.trim()}>
              {deleting ? "Deleting…" : "Permanently delete"}
            </Button>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
