/**
 * @jest-environment jsdom
 */

import { seekLinkedMoment } from "./seekLinkedMoment";

const mountClip = ({ id = "clip.mov", readyState = 4 } = {}) => {
  document.body.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-media-id", id);
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { value: readyState });
  wrapper.appendChild(video);
  document.body.appendChild(wrapper);
  return video;
};

const param = (value: string | null) => () => value;

describe("seekLinkedMoment", () => {
  it("seeks the linked clip to the linked moment", () => {
    const video = mountClip();
    seekLinkedMoment(param("180"), "#clip.mov");
    expect(video.currentTime).toBe(180);
  });

  it("does nothing without a moment, or with an unusable one", () => {
    const video = mountClip();
    seekLinkedMoment(param(null), "#clip.mov");
    seekLinkedMoment(param("0"), "#clip.mov");
    seekLinkedMoment(param("later"), "#clip.mov");
    seekLinkedMoment(param("-5"), "#clip.mov");
    expect(video.currentTime).toBe(0);
  });

  it("waits for metadata when the clip has not loaded yet", () => {
    const video = mountClip({ readyState: 0 });
    seekLinkedMoment(param("42"), "#clip.mov");
    expect(video.currentTime).toBe(0);

    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(42);
  });

  // Ids are filenames: dots, spaces and brackets all reach the selector.
  it("handles an encoded id with selector-special characters", () => {
    const video = mountClip({ id: "a clip (2).mov" });
    seekLinkedMoment(param("12"), `#${encodeURIComponent("a clip (2).mov")}`);
    expect(video.currentTime).toBe(12);
  });

  it("leaves other clips alone", () => {
    const video = mountClip({ id: "other.mov" });
    seekLinkedMoment(param("30"), "#clip.mov");
    expect(video.currentTime).toBe(0);
  });
});
