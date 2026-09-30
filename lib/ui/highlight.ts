// Shared visual treatment for an easy-to-miss action — a control that
// matters but tends to blend into a plain box/button, so it doesn't
// register as something to actually go click/choose (e.g. "now choose
// an add-on group to attach"). Meant to be subtle — a soft tint and a
// thin brand-colored border, not a loud callout — reuse this className
// anywhere on the dashboard with that same "I could easily scroll past
// this" problem, instead of each spot inventing its own emphasis.
//
// Started on the Menu page's "attach a shared add-on" picker.
export const EASY_TO_MISS_HIGHLIGHT = "border border-brand/40 bg-brand-soft/30";
export const EASY_TO_MISS_INPUT_HIGHLIGHT = "border-brand/40 focus:border-brand focus:ring-1 focus:ring-brand/30";
