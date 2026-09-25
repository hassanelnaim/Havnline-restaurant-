"use client";

import { useState, useTransition } from "react";
import { MessageSquare, Ban, ShieldCheck, Trash2, X, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { blockCustomerAction, unblockCustomerAction, deleteCustomerAction } from "@/app/actions/customers";
import type { DbCustomer } from "@/lib/database/types";

export function CustomersClient({ customers }: { customers: DbCustomer[] }) {
  const [active, setActive] = useState<DbCustomer | null>(null);

  return (
    <>
      {/* Desktop/tablet: real table. */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>First seen</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.id} onClick={() => setActive(c)} className="cursor-pointer hover:bg-border-soft/50">
                <TableCell className="font-medium">
                  {c.name}
                  {c.is_blocked && <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-[10.5px] font-medium text-danger">Blocked</span>}
                </TableCell>
                <TableCell className="font-mono text-text-muted">{c.phone}</TableCell>
                <TableCell>{formatDate(c.created_at)}</TableCell>
                <TableCell className="text-right text-[11.5px] text-text-faint">Tap for options</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile: stacked cards, same click behavior. */}
      <div className="space-y-2.5 md:hidden">
        {customers.map((c) => (
          <Card key={c.id} onClick={() => setActive(c)} className="flex cursor-pointer items-center justify-between p-4 active:bg-border-soft/50">
            <div>
              <div className="text-[14px] font-semibold text-ink">
                {c.name}
                {c.is_blocked && <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-[10.5px] font-medium text-danger">Blocked</span>}
              </div>
              <div className="mt-0.5 font-mono text-[12.5px] text-text-muted">{c.phone}</div>
            </div>
            <div className="text-[12px] text-text-faint">{formatDate(c.created_at)}</div>
          </Card>
        ))}
      </div>

      {active && <CustomerActionsSheet customer={active} onClose={() => setActive(null)} />}
    </>
  );
}

function CustomerActionsSheet({ customer, onClose }: { customer: DbCustomer; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleBlockToggle() {
    setError(null);
    startTransition(async () => {
      const result = customer.is_blocked ? await unblockCustomerAction(customer.id) : await blockCustomerAction(customer.id);
      if (!result.success) setError(result.error);
      else onClose();
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCustomerAction(customer.id);
      if (!result.success) setError(result.error);
      else onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-card p-5 shadow-card sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[15px] font-semibold text-ink">{customer.name}</div>
            <div className="mt-0.5 font-mono text-[12.5px] text-text-muted">{customer.phone}</div>
          </div>
          <button onClick={onClose} className="text-text-faint hover:text-text" aria-label="Close">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {error && (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        {!confirmingDelete ? (
          <div className="mt-4 space-y-1">
            <a
              href={`sms:${customer.phone}`}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium text-text hover:bg-border-soft/60"
            >
              <MessageSquare className="h-4 w-4 text-brand" /> Text {customer.name}
            </a>
            <button
              onClick={handleBlockToggle}
              disabled={isPending}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium text-text hover:bg-border-soft/60 disabled:opacity-50"
            >
              {customer.is_blocked ? <ShieldCheck className="h-4 w-4 text-success" /> : <Ban className="h-4 w-4 text-warning" />}
              {customer.is_blocked ? "Unblock this customer" : "Block this customer"}
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={isPending}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Delete customer
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-[13px] text-text-muted">
              Delete <span className="font-medium text-ink">{customer.name}</span>? This can't be undone. Their past calls and orders will stay in your history.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                className="flex-1 rounded-xl border border-border px-3 py-2 text-[13px] font-medium text-text hover:bg-border-soft/60"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 rounded-xl bg-danger px-3 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
