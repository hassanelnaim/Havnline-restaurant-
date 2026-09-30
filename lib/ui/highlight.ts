// Shared visual treatment for "this is the next thing to do" — a
// required second step that's easy to miss because it looks like just
// another plain box (e.g. "now choose an add-on group to attach").
// Reuse this className anywhere on the dashboard that has the same
// shape: a control that only matters once something earlier has
// already been chosen/typed, not a page's default/first action.
//
// Started on the Menu page's "attach a shared add-on" picker — meant
// to be reused wherever else this same pattern shows up, rather than
// each spot inventing its own ad hoc emphasis.
export const NEXT_STEP_HIGHLIGHT = "border-2 border-brand/50 bg-brand-soft/40 ring-1 ring-brand/15";
export const NEXT_STEP_INPUT_HIGHLIGHT = "border-brand/60 focus:border-brand focus:ring-2 focus:ring-brand/30";
