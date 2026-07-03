import { useRef, useEffect } from 'react';

/**
 * useLatestRef(value)
 *
 * Returns a ref whose `.current` is always synchronised to the latest value of
 * `value` via a useEffect.  This replaces the repetitive pattern:
 *
 *   const fooRef = useRef(foo);
 *   useEffect(() => { fooRef.current = foo; }, [foo]);
 *
 * with a single call:
 *
 *   const fooRef = useLatestRef(foo);
 *
 * The returned ref is stable across renders (same object reference), so it is
 * safe to include in dependency arrays of other effects that only need to
 * *read* the latest value without re-running when it changes.
 *
 * @template T
 * @param {T} value  The value to keep current.
 * @returns {React.MutableRefObject<T>}
 */
export function useLatestRef(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/**
 * useLatestRefs(valuesMap)
 *
 * Convenience wrapper for mirroring multiple values at once.
 * Accepts a plain object mapping names → values; returns a matching object of
 * refs, each kept up-to-date via its own useEffect.
 *
 * Usage:
 *   const { magnetModeRef, activeFeedRef } = useLatestRefs({ magnetMode, activeFeed });
 *
 * @param {Record<string, unknown>} valuesMap
 * @returns {Record<string, React.MutableRefObject<unknown>>}
 */
export function useLatestRefs(valuesMap) {
  const result = {};
  // Rules of Hooks require that the number of hook calls is constant, so we
  // rely on callers always passing the same set of keys (same as calling
  // individual useLatestRef calls directly).
  for (const [key, value] of Object.entries(valuesMap)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result[`${key}Ref`] = useLatestRef(value);
  }
  return result;
}
