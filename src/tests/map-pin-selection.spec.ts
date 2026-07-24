import { expect, test, type Page } from "@playwright/test";
import { expectMapLoaded } from "./map-loaded";
import { stubExternalMapAssets } from "./map-network";

/*
 * Selecting a photo pin at world zoom, through the layer that has no DOM.
 *
 * Below the marker-image zoom threshold the pins are drawn on the GPU: there is
 * no element under the pointer, so a pin's click and the map's click are the
 * same gesture. That is what once made this unclickable — the provider's own
 * close-on-map-click handler ran inside that gesture and cleared the selection
 * the tap had just made, and the popup was gone before it could paint.
 *
 * The unit tests around that fix assert the provider's dispatch order by hand,
 * in a double. This spec asserts the outcome against the real MapLibre: a real
 * click at a real pin's pixel, and a popup that is still there afterwards. It is
 * deliberately the only place the drawn layer is clicked, because it is the only
 * place the arbitration between "clicked a pin" and "clicked the map" is real.
 */

/**
 * `albums/test-simple/DSCF0506-2.jpg`'s GPS fix, decimalised the way the build
 * does (`convertDMSToDegree`). Centring the camera here puts its pin at the
 * middle of the canvas, so the pin's screen position needs no projection maths
 * — the centre of the map is the centre of the map.
 *
 * `test-manifest` and `test-manifest-v2` carry the same photo, so this is a
 * stack of co-located pins; clicking selects one of them, which is all this
 * spec asserts about identity.
 */
const PIN_LAT = 36.5788583333333;
const PIN_LNG = 137.5959733333333;
/**
 * Below `MARKER_IMAGE_ZOOM_THRESHOLD` (8.5), which is what keeps the photos on
 * the drawn layer rather than giving each one a DOM marker. Close enough in
 * that the map's other fixture photos are well off-screen, so a click away from
 * the centre lands on empty map rather than on another pin.
 */
const PIN_ZOOM = 8;

/** How far from the centred pin an "empty map" click lands, in canvas widths. */
const EMPTY_CLICK_OFFSET_RATIO = 0.28;

type ScreenPoint = { x: number; y: number };

/**
 * Two paints on from now.
 *
 * Not a wait for time to pass: a click's whole dispatch — MapLibre's layer
 * handlers, the provider's own listeners, and the click-away listener that runs
 * after them — completes within the event, and React has flushed by the next
 * frame. Anything that meant to close this popup has therefore already had its
 * turn, so what is on screen after this is what stays.
 */
const settle = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

/** The map's drawing surface — the only thing a drawn pin can be clicked on. */
const mapCanvas = (page: Page) => page.locator("canvas.maplibregl-canvas").first();

const canvasCentre = async (page: Page): Promise<ScreenPoint> => {
  const box = await mapCanvas(page).boundingBox();
  expect(box, "the map canvas has no box to click in").not.toBeNull();

  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
};

/**
 * Asserts nothing is layered over the point about to be clicked.
 *
 * A click that silently landed on the search bar, a legend or an already-open
 * popup would leave this spec asserting something it never tested, so the
 * canvas being the topmost element is checked rather than assumed.
 */
const expectCanvasAt = async (page: Page, point: ScreenPoint): Promise<void> => {
  const topmost = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);

      return element ? `${element.tagName.toLowerCase()}.${element.className}` : "nothing";
    },
    { x: point.x, y: point.y },
  );

  expect(topmost, `something is covering the map at ${point.x},${point.y}`).toContain(
    "maplibregl-canvas",
  );
};

/**
 * Hovers the centred pin, waits for the map to answer, then clicks it.
 *
 * The hover is not decoration. A pointer has to arrive at a pin before it can
 * click one, and arriving opens the hover popup — so by the time the click is
 * dispatched there is already a popup on the map. That is the state the bug
 * needed: the provider's close-on-map-click handler had something to close, and
 * closing it reported a dismissal that cleared the selection the click had just
 * made. Clicking cold, with no popup open yet, cannot reproduce it.
 */
const selectCentredPin = async (page: Page, centre: ScreenPoint): Promise<void> => {
  await expectCanvasAt(page, centre);
  // Retried, because a pointer move is a one-off event and the pin it has to
  // land on is not: the drawn pins are hit-tested against a source the map
  // tiles in a worker, so a single move dispatched before that finished would
  // report no feature and nothing would ever move the pointer again. The nudge
  // alternates between the centre and a pixel to its right, because moving the
  // pointer to where it already stands raises no event to hit-test on.
  let nudge = 0;
  await expect
    .poll(async () => {
      nudge = nudge === 0 ? 1 : 0;
      await page.mouse.move(centre.x + nudge, centre.y);

      return page.locator(".maplibregl-popup").count();
    })
    .toBeGreaterThan(0);
  // The hover popup: a popup, with no selection-only links in it.
  await expect(page.locator(".maplibregl-popup")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Google Maps" })).toHaveCount(0);

  // Still the canvas underneath: the hover popup must not have covered the pin
  // it describes, or the click below would land on the popup instead.
  await expectCanvasAt(page, centre);
  await page.mouse.click(centre.x, centre.y);
};

test.describe("World map pin selection", () => {
  test.beforeEach(async ({ page }) => {
    await stubExternalMapAssets(page);
    // Camera parameters, so the map frames the pin under test instead of
    // auto-fitting to every photo it was given.
    await page.goto(`/map?lat=${PIN_LAT}&lon=${PIN_LNG}&zoom=${PIN_ZOOM}`, {
      waitUntil: "domcontentloaded",
    });
    await expectMapLoaded(page);

    // The photos in view are announced by the keyboard list, which only the
    // drawn-pin branch renders — so this is both "the pins are on the map" and
    // "they are the drawn ones". If the zoom threshold ever moves, the DOM
    // markers appear instead and this fails rather than quietly retargeting the
    // spec at the code path that was never broken.
    await expect(page.getByRole("list", { name: "Photos in view" })).toBeAttached();
    await expect(page.locator("[data-map-pin]")).toHaveCount(0);
  });

  test("opens a selected popup when a drawn pin is clicked, and keeps it open", async ({
    page,
  }) => {
    const centre = await canvasCentre(page);
    const externalMapLink = page.getByRole("link", { name: "Open in Google Maps" });

    await selectCentredPin(page, centre);

    // The selected popup, told apart from the hover popup by content rather
    // than styling: only a selection offers the photo's location elsewhere.
    await expect(externalMapLink).toBeVisible();

    // The bug was not that the popup never opened — it was that it opened and
    // was closed again inside the same gesture. Assert it survives the gesture.
    await settle(page);
    await expect(externalMapLink).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in OpenStreetMap" })).toBeVisible();
  });

  test("dismisses the selected popup when the map itself is clicked", async ({ page }) => {
    const centre = await canvasCentre(page);
    const externalMapLink = page.getByRole("link", { name: "Open in Google Maps" });

    await selectCentredPin(page, centre);
    await expect(externalMapLink).toBeVisible();

    // The other half of the arbitration: a click that lands on no pin still has
    // to dismiss, or the fix would just be a popup that can never be closed.
    const box = await mapCanvas(page).boundingBox();
    expect(box).not.toBeNull();
    const empty = { x: centre.x + box!.width * EMPTY_CLICK_OFFSET_RATIO, y: centre.y };
    await expectCanvasAt(page, empty);

    await page.mouse.click(empty.x, empty.y);

    await expect(externalMapLink).toHaveCount(0);
    await settle(page);
    await expect(externalMapLink).toHaveCount(0);
  });
});
