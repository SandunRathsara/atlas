export const createActivityGate = () => {
  let paused = false;
  let active = 0;
  const waiters = new Set<() => void>();

  const enter = () => {
    if (paused) return false;
    active += 1;
    return true;
  };

  const leave = () => {
    if (active === 0) return false;
    active -= 1;
    if (active !== 0) return false;
    for (const resolve of waiters) resolve();
    waiters.clear();
    return true;
  };

  const pause = () => {
    paused = true;
    return active === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => waiters.add(resolve));
  };

  return {
    enter,
    leave,
    pause,
    resume: () => {
      if (!paused) return false;
      paused = false;
      return true;
    },
    paused: () => paused,
    active: () => active,
  };
};
