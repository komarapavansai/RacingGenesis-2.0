import * as THREE from "./three.module.js";

function makeRingMesh(rows, sides, sample, reverse = false) {
  const vertices = [], indices = [];
  const triangle = (a, b, c) => indices.push(a, reverse ? c : b, reverse ? b : c);
  for (let row = 0; row < rows; row++) {
    for (let side = 0; side < sides; side++) {
      vertices.push(...sample(row, side / sides * Math.PI * 2));
      if (row === rows - 1) continue;
      const a = row * sides + side;
      const b = row * sides + (side + 1) % sides;
      triangle(a, b, a + sides);
      triangle(b, b + sides, a + sides);
    }
  }
  const last = (rows - 1) * sides;
  for (let i = 1; i < sides - 1; i++) {
    triangle(0, i + 1, i);
    triangle(last, last + i, last + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function smooth(a, b, c, d, t) {
  return b + 0.5 * t * ((c - a) + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

// Each longitudinal station is [z, center x, center y, half width, half height].
export function sculptBody(stations) {
  const steps = 5;
  const count = (stations.length - 1) * steps + 1;
  return makeRingMesh(count, 24, (row, angle) => {
    const i = Math.min(stations.length - 2, Math.floor(row / steps));
    const t = row / steps - i;
    const [a, b, c, d] = [stations[Math.max(0, i - 1)], stations[i], stations[i + 1], stations[Math.min(stations.length - 1, i + 2)]];
    const at = field => smooth(a[field], b[field], c[field], d[field], t);
    return [
      at(1) + Math.cos(angle) * Math.max(0.005, at(3)),
      at(2) + Math.sin(angle) * Math.max(0.005, at(4)),
      THREE.MathUtils.lerp(b[0], c[0], t),
    ];
  });
}

// Wing stations are [span x, leading edge z, chord length, height].
export function shapeAerofoil(stations, thickness, camber) {
  return makeRingMesh(stations.length, 24, (row, angle) => {
    const [x, leadingEdge, chord, y] = stations[row];
    const fraction = (1 - Math.cos(angle)) / 2;
    return [
      x,
      y + Math.sin(Math.PI * fraction) * camber + Math.sin(angle) * thickness * (1 - fraction * 0.55),
      leadingEdge - chord * fraction,
    ];
  }, true);
}

export function shapePanel(outline, depth, bevel) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    steps: 1,
  }).translate(0, 0, -depth / 2);
}

export function shapeSlick(radius, width, innerRadius) {
  const half = width / 2;
  const profile = [
    [innerRadius, -half * 0.88],
    [radius * 0.83, -half],
    [radius * 0.94, -half * 0.98],
    [radius * 0.985, -half * 0.78],
    [radius, -half * 0.42],
    [radius, half * 0.42],
    [radius * 0.985, half * 0.78],
    [radius * 0.94, half * 0.98],
    [radius * 0.83, half],
    [innerRadius, half * 0.88],
    [innerRadius, -half * 0.88],
  ];
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 40).rotateZ(Math.PI / 2);
}
