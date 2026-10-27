import assert from "node:assert/strict";
import test from "node:test";
import { createMessagePressGesture } from "../../client/src/lib/message-press-gesture";

function fixture() {
  let now = 0;
  let next = 0;
  let opened = 0;
  const tasks = new Map<number, { at: number; work: () => void }>();
  const clock = {
    set(work: () => void, delay: number) { const id = ++next; tasks.set(id, { at: now + delay, work }); return id as unknown as ReturnType<typeof setTimeout>; },
    clear(id: ReturnType<typeof setTimeout>) { tasks.delete(id as unknown as number); },
  };
  const gesture = createMessagePressGesture(() => { opened++; }, clock);
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [id, task] of tasks) if (task.at <= now) { tasks.delete(id); task.work(); }
  };
  return { gesture, advance, opened: () => opened };
}

test("holding a message opens its menu once after half a second", () => {
  const f = fixture(); f.gesture.start(30, 50);
  f.advance(499); assert.equal(f.opened(), 0);
  f.advance(1); assert.equal(f.opened(), 1);
  f.advance(1000); assert.equal(f.opened(), 1);
});

test("a tap, a cancelled touch and scrolling do not open the message menu", () => {
  for (const stop of [(g: ReturnType<typeof createMessagePressGesture>) => g.cancel(), (g: ReturnType<typeof createMessagePressGesture>) => g.move(30, 65)]) {
    const f = fixture(); f.gesture.start(30, 50); f.advance(200); stop(f.gesture); f.advance(1000);
    assert.equal(f.opened(), 0);
  }
});

test("small finger movement is tolerated but diagonal scrolling cancels the hold", () => {
  const f = fixture(); f.gesture.start(30, 50); f.gesture.move(34, 53); f.advance(500); assert.equal(f.opened(), 1);
  const scroll = fixture(); scroll.gesture.start(30, 50); scroll.gesture.move(36, 56); scroll.advance(500); assert.equal(scroll.opened(), 0);
});

test("starting a new press cancels the old timer", () => {
  const f = fixture(); f.gesture.start(30, 50); f.advance(300); f.gesture.start(40, 60);
  f.advance(200); assert.equal(f.opened(), 0); f.advance(300); assert.equal(f.opened(), 1);
});
