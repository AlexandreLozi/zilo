import type { ZiloEvent, ZiloEventDetailMap, ZiloTheme } from '@zilo/ui';
import {
  createElement,
  useCallback,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

/** Maps a React callback prop name (`onClose`) to the Zilo event it listens for. */
export type EventPropMap = Readonly<Record<string, keyof ZiloEventDetailMap>>;

/** Callback props generated from an `EventPropMap`. */
export type EventProps<M extends EventPropMap> = {
  readonly [P in keyof M]?: (event: ZiloEvent<M[P]>) => void;
};

/** Props every wrapper accepts: DOM attributes (minus names the wrappers redefine), `theme`, `ref`. */
export type BaseProps<E extends HTMLElement, Omitted extends string> = Omit<
  HTMLAttributes<E>,
  'onCancel' | 'onClose' | 'title' | Omitted
> & {
  /** `light`, `dark` or `auto`; unset inherits the nearest themed Zilo ancestor. */
  readonly theme?: ZiloTheme | undefined;
  readonly children?: ReactNode | undefined;
  readonly ref?: Ref<E> | undefined;
};

export type ZiloComponentProps<
  E extends HTMLElement,
  P extends object,
  M extends EventPropMap,
> = BaseProps<E, Extract<keyof P | keyof M, string>> & {
  readonly [K in keyof P]?: P[K];
} & EventProps<M>;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

/**
 * Builds a typed React component for a Zilo custom element.
 *
 * - `defaults` lists the element properties the wrapper owns and the value each returns to when the
 *   prop is omitted. They are assigned as **properties** (not attributes) in a layout effect, so
 *   booleans and object values (for example `initialFocus`) work and the element sees them before
 *   the browser paints.
 * - `events` maps callback props to Zilo `CustomEvent` names; listeners are attached once and always
 *   call the latest callback.
 * - `ref` is forwarded to the element (React 19 passes `ref` as a prop).
 */
export function createZiloComponent<
  E extends HTMLElement,
  P extends object,
  M extends EventPropMap,
>(
  tagName: string,
  displayName: string,
  defaults: P,
  events: M,
): (props: ZiloComponentProps<E, P, M>) => ReactElement {
  const propNames = Object.keys(defaults) as (keyof P & string)[];
  const eventEntries = Object.entries(events) as [keyof M & string, keyof ZiloEventDetailMap][];

  function Component(props: ZiloComponentProps<E, P, M>): ReactElement {
    const { ref, theme, children, ...rest } = props as ZiloComponentProps<E, P, M> &
      Record<string, unknown>;
    const elementRef = useRef<E | null>(null);
    const callbacks = useRef<Record<string, unknown>>({});

    const domProps: Record<string, unknown> = {};
    const ownProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if ((propNames as string[]).includes(key)) ownProps[key] = value;
      else if (key in events) callbacks.current[key] = value;
      else domProps[key] = value;
    }
    for (const [key] of eventEntries) {
      if (!(key in rest)) callbacks.current[key] = undefined;
    }

    const setRef = useCallback(
      (el: E | null) => {
        elementRef.current = el;
        assignRef(ref, el);
      },
      [ref],
    );

    useLayoutEffect(() => {
      const el = elementRef.current as Record<string, unknown> | null;
      if (!el) return;
      for (const name of propNames) {
        const value = ownProps[name];
        const next: unknown = value === undefined ? defaults[name] : value;
        if (el[name] !== next) el[name] = next;
      }
    });

    useLayoutEffect(() => {
      const el = elementRef.current;
      if (!el) return;
      const listeners = eventEntries.map(([prop, type]) => {
        const listener = (event: Event): void => {
          const callback = callbacks.current[prop];
          if (typeof callback === 'function') (callback as (e: Event) => void)(event);
        };
        el.addEventListener(type, listener);
        return [type, listener] as const;
      });
      return () => {
        for (const [type, listener] of listeners) el.removeEventListener(type, listener);
      };
    }, []);

    return createElement(
      tagName,
      { ...domProps, theme, ref: setRef, suppressHydrationWarning: true },
      children,
    );
  }

  Component.displayName = displayName;
  return Component;
}
