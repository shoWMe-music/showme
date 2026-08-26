/**
 * Write a value into an input so that React notices.
 *
 * React installs its own `value` setter on the element and remembers the last
 * value it saw; assigning `input.value` would update the DOM but look like a
 * no-op to React, so no change event would reach the parent. Writing through
 * the PROTOTYPE's setter and then dispatching `input` is what makes a
 * programmatic edit indistinguishable from a typed one — which is the whole
 * contract the in-app pickers rely on: every caller keeps its existing
 * `value`/`onChange` pair and never learns that the picker is ours.
 */
export function commitFieldValue(input: HTMLInputElement | null, nextValue: string) {
  if (!input) return;
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  nativeValueSetter?.call(input, nextValue);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
