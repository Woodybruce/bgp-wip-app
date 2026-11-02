/** A held touch opens actions; taps, scrolling and cancelled gestures do not. */
export function createMessagePressGesture(open: () => void, clock = {
  set: (work: () => void, delay: number) => setTimeout(work, delay),
  clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number } | undefined;
  const cancel = () => {
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    origin = undefined;
  };
  return {
    start(x: number, y: number) {
      cancel();
      origin = { x, y };
      timer = clock.set(() => { timer = undefined; origin = undefined; open(); }, 500);
    },
    move(x: number, y: number) {
      if (origin && Math.hypot(x - origin.x, y - origin.y) > 8) cancel();
    },
    cancel,
  };
}
