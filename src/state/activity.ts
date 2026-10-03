import { create } from 'zustand';

/*
 * Gestures under way that the graph store does not see, for whatever wants
 * to follow them -- the shortcut hints, so far. A node drag and a wire drag
 * already show in React Flow's own state; scrubbing a value is ours.
 */

type ActivityState = {
  scrubbing: boolean;
};

export const useActivity = create<ActivityState>(() => ({ scrubbing: false }));

export const setScrubbing = (on: boolean): void => {
  if (useActivity.getState().scrubbing !== on) useActivity.setState({ scrubbing: on });
};
