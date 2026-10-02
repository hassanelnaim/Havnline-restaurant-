import { redirect } from "next/navigation";

// End of Day's date picker and printable report moved into the Orders
// page itself (see app/dashboard/orders) — this route just forwards
// anyone who still has the old link or a browser bookmark.
export default function EndOfDayPage() {
  redirect("/dashboard/orders");
}
