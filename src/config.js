// World layout constants (metres). The city is a grid of roads; blocks sit between them.
export const GRID = 100;            // distance between parallel road centre lines
export const NB = 8;                // blocks per side
export const CITY_HALF = (GRID * NB) / 2; // 400 -> road lines from -400..400
export const LINES = NB + 1;        // road lines per axis
export const ROAD_HALF = 7;         // 2 lanes each way, 3.5 m each
export const LANE_W = 3.5;
export const SIDEWALK = 4;
export const CURB_H = 0.15;
export const CITY_EDGE = CITY_HALF + ROAD_HALF + SIDEWALK; // 411: outer edge of paved city
export const WORLD_HALF = 1200;     // playable world extends to +-1200
export const WATER_LEVEL = -1.2;

// Traffic geometry along a road segment (distances measured from an intersection centre)
export const STOP_DIST = 12.5;      // stop line distance from node centre
export const CROSS_NEAR = 8;        // crosswalk band from 8..11 m from the node
export const CROSS_FAR = 11;
export const PED_RING = ROAD_HALF + 2.5; // pedestrians walk 2.5 m in from the curb face

export const lineCoord = (i) => -CITY_HALF + i * GRID;

export const QUALITY = {
  low: {
    pixelRatio: 0.75, shadows: false, shadowSize: 1024, grass: 0.25, trees: 0.5,
    bloom: false, cars: 26, peds: 18, drivers: 6, texSize: 512, pointLights: 0, msaa: 0,
  },
  medium: {
    pixelRatio: 1.0, shadows: true, shadowSize: 2048, grass: 0.6, trees: 0.8,
    bloom: true, cars: 38, peds: 30, drivers: 10, texSize: 1024, pointLights: 2, msaa: 0,
  },
  high: {
    pixelRatio: 1.5, shadows: true, shadowSize: 4096, grass: 1.0, trees: 1.0,
    bloom: true, cars: 50, peds: 42, drivers: 14, texSize: 1024, pointLights: 4, msaa: 4,
  },
};
