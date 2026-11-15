import assert from "node:assert/strict";

async function replaceVisibleHtml(host, scene, time) {
  return host.frame.evaluate(
    ({ scene, time }) => {
      const label = document.getElementById("label-a");
      const strip = label.querySelector(".clock-bits");
      const clock = label.querySelector(".clock");
      const saved = {
        text: clock.textContent,
        prefix: label.firstChild.textContent,
        bits: strip.innerHTML,
      };
      label.firstChild.textContent = `${scene} · `;
      clock.textContent = time.toFixed(3);
      strip.children[2].style.background = scene === "B" ? "#fff" : "#000";
      for (let i = 3; i < strip.children.length; i++)
        strip.children[i].style.background = (time >> (i - 3)) & 1 ? "#fff" : "#000";
      return saved;
    },
    { scene, time },
  );
}

async function rejectMixedPicture(host, picture, scene, time, expected) {
  const saved = await replaceVisibleHtml(host, scene, time);
  try {
    await assert.rejects(picture(host, `witness-mixed-${scene}`), expected);
  } finally {
    await host.frame.evaluate((saved) => {
      const label = document.getElementById("label-a");
      label.firstChild.textContent = saved.prefix;
      label.querySelector(".clock").textContent = saved.text;
      label.querySelector(".clock-bits").innerHTML = saved.bits;
    }, saved);
  }
}

export async function verifyCaptureIsolation(host, { picture, seek }) {
  const original = host.page.screenshot.bind(host.page);
  let published = false;
  host.page.screenshot = async (options) => {
    const png = await original(options);
    if (options.encoding === "base64" && !published) {
      published = true;
      await seek(host, 7);
    }
    return png;
  };
  let captured;
  try {
    captured = await picture(host, "witness-publish-after-capture");
  } finally {
    host.page.screenshot = original;
  }
  assert(published, "The capture witness did not interleave a publication");
  assert.equal(captured.scene, "A");
  assert.equal(captured.capturedHtml.shownTime, 2);
  assert(captured.labels[0].startsWith("B"), "The post-capture DOM did not publish scene B");
  await seek(host, 2);
  await rejectMixedPicture(host, picture, "B", 8, /background disagrees with B/);
  await rejectMixedPicture(host, picture, "A", 4, /video pixels disagree with the HTML clock/);
  return { publishedAfterCapture: true, mixedSceneRejected: true, mixedClockRejected: true };
}
