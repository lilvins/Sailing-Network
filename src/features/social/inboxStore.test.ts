import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadSummary } from "../../lib/api";
import { api } from "../../lib/api";
import { selectUnread, useInboxStore } from "./inboxStore";

const thread = (username: string, lastAt: number, unread: number, lastFromMe = false): ThreadSummary => ({
  peer: { id: username, username, displayName: username.toUpperCase() },
  lastBody: "ahoy",
  lastAt,
  lastFromMe,
  unread,
});

const pollReturns = (...threads: ThreadSummary[]) =>
  vi.spyOn(api, "myThreads").mockResolvedValueOnce({ threads });

afterEach(() => {
  useInboxStore.getState().stop();
  vi.restoreAllMocks();
});

describe("inbox polling", () => {
  it("letters waiting at the first poll light the icon but raise no notice", async () => {
    pollReturns(thread("zoro", 100, 2));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().notice).toBeNull();
    expect(selectUnread(useInboxStore.getState())).toBe(2);
  });

  it("a new letter raises a notice saying who and what", async () => {
    pollReturns(thread("zoro", 100, 0));
    await useInboxStore.getState().refresh();
    pollReturns(thread("zoro", 200, 1));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().notice).toMatchObject({ username: "zoro", displayName: "ZORO", body: "ahoy" });
  });

  it("the same letter polled again does not notify twice", async () => {
    pollReturns(thread("zoro", 100, 0));
    await useInboxStore.getState().refresh();
    pollReturns(thread("zoro", 200, 1));
    await useInboxStore.getState().refresh();
    useInboxStore.getState().dismissNotice();
    pollReturns(thread("zoro", 200, 1));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().notice).toBeNull();
  });

  it("the thread being read neither notifies nor counts as unread", async () => {
    pollReturns(thread("zoro", 100, 0));
    await useInboxStore.getState().refresh();
    useInboxStore.getState().setViewing("zoro");
    pollReturns(thread("zoro", 200, 1));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().notice).toBeNull();
    expect(selectUnread(useInboxStore.getState())).toBe(0);
  });

  it("your own last message does not notify", async () => {
    pollReturns(thread("zoro", 100, 0));
    await useInboxStore.getState().refresh();
    pollReturns(thread("zoro", 200, 0, true));
    await useInboxStore.getState().refresh();
    expect(useInboxStore.getState().notice).toBeNull();
  });
});
