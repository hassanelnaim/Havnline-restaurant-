import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { getAllReviewsForModeration } from "@/lib/data/reviews";
import { ReviewModeration } from "@/components/admin/review-moderation";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  await requirePlatformAdmin();
  const reviews = await getAllReviewsForModeration();
  const pending = reviews.filter((r) => r.status === "pending");
  const approved = reviews.filter((r) => r.status === "approved").length;

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold text-ink">Reviews</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">
        Reviews submitted for the HavnLine website. Approved ones show on the landing page; {approved} so far.
      </p>
      {pending.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5 text-[13px] text-text-muted shadow-card">Nothing waiting for moderation.</div>
      ) : (
        <ReviewModeration pendingReviews={pending} />
      )}
    </div>
  );
}
