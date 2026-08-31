import { useEffect, useState } from "react";

/**
 * The value, after it has stopped changing for `delayMilliseconds`.
 *
 * Every type-ahead in this app wants exactly this: the keystrokes drive the
 * input, the settled value drives the request. It was written out three times
 * (venue picker, performer search, address lookup) before it was worth naming —
 * and the address one talks to a metered third party, where a request per
 * keystroke is a bill as well as a flicker.
 */
export function useDebouncedValue<Value>(value: Value, delayMilliseconds: number): Value {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMilliseconds);
    return () => clearTimeout(handle);
  }, [value, delayMilliseconds]);
  return debounced;
}
