import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { parseHTML } from "linkedom";
import type { IControl } from "maplibre-gl";
import type { Feature } from "geojson";
import {
  flattenFeatureVertices,
  formatAngle,
  formatDistance,
  maplibreDimensionsPlugin,
  metersToUnit,
  resolveTiePosition,
  setDimensionLabels,
} from "../packages/plugins/src/plugins/maplibre-dimensions";
import type { GeoLibreAppAPI } from "../packages/plugins/src/types";
import type { GeoLibreLayer } from "../packages/core/src/types";

describe("dimension units", () => {
  it("converts meters into every supported unit", () => {
    assert.equal(metersToUnit(1000, "km"), 1);
    assert.equal(Math.round(metersToUnit(1609.344, "mi")), 1);
    assert.equal(Math.round(metersToUnit(0.3048 * 10, "ft")), 10);
  });

  it("formats a distance with its unit suffix", () => {
    assert.equal(formatDistance(1000, "m", 0), "1000 m");
    assert.equal(formatDistance(1000, "km", 2), "1.00 km");
  });

  it("formats an angle with a degree suffix", () => {
    assert.equal(formatAngle(90), "90.0°");
    assert.equal(formatAngle(45.567, 2), "45.57°");
  });
});

describe("dimension vertex flattening", () => {
  it("flattens every geometry type into a position list", () => {
    const point: Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [1, 2] },
      properties: {},
    };
    const line: Feature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      },
      properties: {},
    };
    const polygon: Feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      properties: {},
    };
    assert.deepEqual(flattenFeatureVertices(point), [[1, 2]]);
    assert.equal(flattenFeatureVertices(line).length, 3);
    assert.equal(flattenFeatureVertices(polygon).length, 4);
  });

  it("returns an empty list for a feature with no geometry", () => {
    const empty: Feature = {
      type: "Feature",
      geometry: null as never,
      properties: {},
    };
    assert.deepEqual(flattenFeatureVertices(empty), []);
  });
});

function makeLayer(overrides: Partial<GeoLibreLayer>): GeoLibreLayer {
  return {
    id: "layer",
    name: "Layer",
    type: "geojson",
    source: {},
    visible: true,
    opacity: 1,
    style: {} as GeoLibreLayer["style"],
    metadata: {},
    ...overrides,
  };
}

describe("resolveTiePosition", () => {
  it("resolves a vertex tie to the feature's current vertex position", () => {
    const layer = makeLayer({
      id: "vector-1",
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "f1",
            geometry: {
              type: "LineString",
              coordinates: [
                [0, 0],
                [3, 4],
              ],
            },
            properties: {},
          },
        ],
      },
    });
    const position = resolveTiePosition(
      { layerId: "vector-1", featureId: "f1", featureIndex: 0, vertexIndex: 1 },
      [layer],
    );
    assert.deepEqual(position, [3, 4]);
  });

  it("returns null when the tied layer no longer exists", () => {
    const position = resolveTiePosition(
      { layerId: "gone", featureId: null, featureIndex: 0, vertexIndex: 0 },
      [],
    );
    assert.equal(position, null);
  });

  it("returns null when the tied vertex index is out of range", () => {
    const layer = makeLayer({
      id: "vector-1",
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
          },
        ],
      },
    });
    const position = resolveTiePosition(
      { layerId: "vector-1", featureId: null, featureIndex: 0, vertexIndex: 5 },
      [layer],
    );
    assert.equal(position, null);
  });
});

describe("dimension toolbar", () => {
  let restoreGlobals: () => void;
  let control: IControl | null;
  let app: GeoLibreAppAPI;

  beforeEach(() => {
    const { document, window } = parseHTML("<html><body></body></html>");
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    Object.assign(globalThis, { document, window });
    restoreGlobals = () => {
      Object.assign(globalThis, {
        document: previousDocument,
        window: previousWindow,
      });
    };

    control = null;
    app = {
      addMapControl: (nextControl) => {
        control = nextControl;
        return true;
      },
      removeMapControl: (removedControl) => removedControl.onRemove(),
      getMap: () => null,
    } as GeoLibreAppAPI;

    setDimensionLabels({
      collapse: "Collapse toolbar",
      expand: "Expand toolbar",
      snap: "Snap to vertices",
    });
    maplibreDimensionsPlugin.activate(app);
  });

  afterEach(() => {
    maplibreDimensionsPlugin.deactivate(app);
    restoreGlobals();
  });

  it("renders exactly two tools (Linear, Angular), both enabled", () => {
    assert.ok(control);
    const container = control.onAdd(null as never);
    const tools = container.querySelectorAll<HTMLButtonElement>(".geolibre-dimensions-tool");
    assert.equal(tools.length, 2);
    for (const tool of tools) assert.equal(tool.disabled, false);
  });

  it("renders a Snap toggle button the user can turn on and off", () => {
    assert.ok(control);
    const container = control.onAdd(null as never);
    const snap = container.querySelector<HTMLButtonElement>(".geolibre-dimensions-snap");
    assert.ok(snap);
    assert.equal(snap.getAttribute("aria-label"), "Snap to vertices");
    // On by default.
    assert.equal(snap.getAttribute("aria-pressed"), "true");
    assert.ok(snap.classList.contains("is-active"));

    snap.click();
    assert.equal(snap.getAttribute("aria-pressed"), "false");
    assert.ok(!snap.classList.contains("is-active"));

    snap.click();
    assert.equal(snap.getAttribute("aria-pressed"), "true");
  });

  it("folds to one accessible button and expands again", () => {
    assert.ok(control);
    const container = control.onAdd(null as never);
    const toggle = container.querySelector<HTMLButtonElement>(".geolibre-dimensions-collapse");
    const tools = container.querySelector<HTMLElement>(".geolibre-dimensions-tools");
    assert.ok(toggle);
    assert.ok(tools);
    assert.equal(toggle.getAttribute("aria-label"), "Collapse toolbar");
    assert.equal(tools.hidden, false);

    toggle.click();
    assert.equal(tools.hidden, true);
    assert.equal(toggle.getAttribute("aria-label"), "Expand toolbar");

    toggle.click();
    assert.equal(tools.hidden, false);
  });
});
