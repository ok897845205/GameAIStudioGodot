"use client";
import { useState, useEffect } from "react";

export type Subscribable<T> = {
  getState: () => T;
  subscribe: (callback: () => void) => () => void;
};

/**
 * Bridges a runtime-api binding (anything with `getState` + `subscribe`) into
 * React. Re-renders on every notification and returns the freshest state.
 */
export const useSubscribable = <T>(subscribable: Subscribable<T>): T => {
  const [, setState] = useState(subscribable.getState);
  useEffect(() => {
    setState(subscribable.getState());
    return subscribable.subscribe(() => {
      setState(subscribable.getState());
    });
  }, [subscribable]);

  return subscribable.getState();
};
