/**
 * Racing Genesis - Assignment 3 MVP Advanced Simulator (Windows 11 Edition v3.0)
 *
 * Technologies: Three.js, WebGL, Web Audio API, ES Modules.
 * Core Features:
 * - 3D In-Car Physical Digital Dashboard mounted on steering wheel (Gears 1-8, Speed, RPM, Laps, Shift Lights)
 * - Start/Finish Gantry & Checkered Line fixed perfectly horizontal across track width
 * - Smooth Vehicle Physics (Jerk-limited acceleration, progressive threshold braking, smooth bicycle steering, natural cornering tire scrub)
 * - Real-life F1 Performance (220+ mph straights, 0-60 in 2.4s, 5.0G peak braking)
 * - Microsoft Windows 11 Fluent style interface with collapsible left and right drawer panels
 * - Curvilinear aerodynamic real-life F1 bodywork (curved aerofoils, organic nosecone, contoured sidepods, Halo, shark fin)
 * - Clearly visible spinning wheels with rotating spokes, anodized center nuts, and Pirelli sidewall markings
 * - 60+ FPS zero-allocation physics loop
 */

import * as THREE from "./three.module.js";
import { CIRCUIT_LAYOUTS } from "./circuit-layouts.js";
import { TrackOverview } from "./track-overview.js";
import { TrackCrowd } from "./track-crowd.js";
import { sculptBody, shapeAerofoil, shapePanel, shapeSlick } from "./race-car-geometry.js";

// Dispose an owned subtree once per resource, including nested meshes and textures.
function disposeGroupContents(group, ownedMaterials = []) {
  const geometries = new Set(), materials = new Set(ownedMaterials.filter(Boolean)), textures = new Set();
  group.traverse(object => {
    if (object.isInstancedMesh) object.dispose();
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [].concat(object.material || [])) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value && value.isTexture) textures.add(value);
      }
    }
  });
  group.clear();
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

// Unit conversions
const MS_TO_MPH = 2.23694;
const MPH_TO_MS = 1 / MS_TO_MPH;
const G_ACCEL = 9.81;
const PHYSICS_STEP = 1 / 120;

// DOM helper
const $ = (id) => document.getElementById(id);
const setElText = (id, txt) => {
  const el = $(id);
  if (el) el.textContent = txt;
};

// Pre-allocated scratch vectors for zero runtime GC allocations (Rock-solid 60+ FPS)
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _pPrev = new THREE.Vector3();
const _pCurr = new THREE.Vector3();
const _pNext = new THREE.Vector3();
const _crossVec = new THREE.Vector3();
const _lookAtPt = new THREE.Vector3();
const _currentCarPos = new THREE.Vector3();
const _targetTrajectoryPt = new THREE.Vector3();
const _trajectoryVec = new THREE.Vector3();
const _hPrev = new THREE.Vector3();
const _hNext = new THREE.Vector3();
const _camForwardVec = new THREE.Vector3();
const _scratchTangent = new THREE.Vector3();
const _scratchNormal = new THREE.Vector3();

/* ==========================================================================
   Procedural Textures (Self-Contained, Zero External Dependencies)
   ========================================================================== */

function createGrassTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#465b30";
  ctx.fillRect(0, 0, 512, 512);

  // Mowing stripes
  const stripeWidth = 64;
  for (let x = 0; x < 512; x += stripeWidth * 2) {
  ctx.fillStyle = "#485d31";
    ctx.fillRect(x, 0, stripeWidth, 512);
  }

  // Subtle organic blade noise
  const imgData = ctx.getImageData(0, 0, 512, 512);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 20;
    data[i] = Math.max(0, Math.min(255, data[i] + noise * 0.7));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * 0.5));
  }
  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(36, 36);
  return texture;
}

function createSkyGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 512, 0, 0);
  grad.addColorStop(0, '#e2effa'); // Atmosphere horizon
  grad.addColorStop(0.2, '#b2d7f7'); // Low sky
  grad.addColorStop(0.6, '#4691e4'); // Mid sky
  grad.addColorStop(1.0, '#155bb3'); // Deep zenith
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 512);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

function createAsphaltTexture() {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let seed = 71;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const grain = 52 + (seed >>> 27);
    pixels[i] = grain;
    pixels[i + 1] = grain + 2;
    pixels[i + 2] = grain + 4;
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function createCurbTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 4;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#cf3e3e";
  ctx.fillRect(0, 0, 32, 4);
  ctx.fillStyle = "#e8e6df";
  ctx.fillRect(32, 0, 32, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.anisotropy = 4;
  return texture;
}


function paintChecks(ctx, x, y, width, height, cols, rows, light = "#f4f8fc", dark = "#121c29") {
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (row + col) % 2 ? dark : light;
      ctx.fillRect(x + col * cellWidth, y + row * cellHeight, cellWidth, cellHeight);
    }
  }
}

function createCheckeredFinishTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  paintChecks(ctx, 0, 0, 512, 128, 12, 2);
  ctx.fillStyle = "#62e3df";
  ctx.fillRect(0, 60, 512, 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createGantryBannerTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, 0, 256);
  background.addColorStop(0, "#263849");
  background.addColorStop(1, "#0b141e");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = "#62e3df";
  ctx.fillRect(0, 0, 1024, 8);
  ctx.fillRect(0, 248, 1024, 8);

  paintChecks(ctx, 36, 68, 120, 120, 4, 4);
  paintChecks(ctx, 868, 68, 120, 120, 4, 4);
  ctx.textAlign = "center";
  ctx.fillStyle = "#62e3df";
  ctx.font = "700 35px 'Segoe UI', sans-serif";
  ctx.fillText("RACING GENESIS", 512, 81);
  ctx.fillStyle = "#f4f8fc";
  ctx.font = "900 90px 'Segoe UI', sans-serif";
  ctx.fillText("START / FINISH", 512, 187, 670);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFinishFlagTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  paintChecks(ctx, 0, 0, 512, 256, 8, 4);
  ctx.fillStyle = "#62e3df";
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createWheelSidewallTexture(colorHex = "#ffd200") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, 256, 256);

  // Outer dark tire rubber
  ctx.fillStyle = "#181a1e";
  ctx.beginPath();
  ctx.arc(128, 128, 126, 0, Math.PI * 2);
  ctx.arc(128, 128, 70, 0, Math.PI * 2, true);
  ctx.fill();

  // Vibrant Pirelli sidewall color ring
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 102, 0, Math.PI * 2);
  ctx.stroke();

  // 4 High-contrast white tire brand marks at 90-degree quadrants
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const labels = ["P ZERO", "RG3", "P ZERO", "F1"];
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    ctx.save();
    ctx.translate(128, 128);
    ctx.rotate(angle);
    ctx.translate(0, -102);
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/* ==========================================================================
   3D Procedural Spline Track with Perfectly Horizontal Start/Finish
   ========================================================================== */

class Track3D {
  constructor(scene) {
    this.scene = scene;
    this.app = null;
    this.activePathOffsets = null;
    this.layoutKey = "workshop";
    this.targetLength = CIRCUIT_LAYOUTS.workshop.length;
    this.lengthScale = this.targetLength / 520;
    this.roadWidth = 12.0;
    this.curveStrength = 0.45;
    this.sampleCount = 600;
    this.samples = [];

    // Control anchor points
    this.controlPoints = [];
    this.handleObjects = [];
    this.handleMeshes = [];
    this.editHandlesVisible = false;

    // Groups
    this.trackGroup = new THREE.Group();
    this.handleGroup = new THREE.Group();
    this.scene.add(this.trackGroup);
    this.scene.add(this.handleGroup);

    this.roadMesh = null;
    this.curbMesh = null;
    this.racingLineMesh = null;
    this.brakingZoneMesh = null;
    this.denseStressMode = false;

    this.initControlPoints();
    this.build3DHandles();
    this.scaleTrackToTargetLength(this.targetLength || 5000);
  }

  scaleTrackToTargetLength(targetMeters) {
    if (!targetMeters || isNaN(targetMeters)) targetMeters = 5000;
    targetMeters = Math.max(1000, Math.min(10000, Math.round(targetMeters)));
    this.targetLength = targetMeters;
    this.lengthScale = targetMeters / 520;

    let cx = 0, cz = 0;
    const n = this.controlPoints.length;
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      cx += this.controlPoints[i].x;
      cz += this.controlPoints[i].z;
    }
    cx /= n;
    cz /= n;

    const tempCurve = this.createCurve();
    const rawLen = tempCurve.getLength() || 520;
    const factor = targetMeters / rawLen;

    for (let i = 0; i < n; i++) {
      this.controlPoints[i].x = cx + (this.controlPoints[i].x - cx) * factor;
      this.controlPoints[i].z = cz + (this.controlPoints[i].z - cz) * factor;
    }

    this.updateAllHandleVisuals();
    this.rebuildTrackFromPoints();
  }

  getBoundingRadius() {
    let maxR2 = 100;
    for (let i = 0; i < this.controlPoints.length; i++) {
      const p = this.controlPoints[i];
      const r2 = p.x * p.x + p.z * p.z;
      if (r2 > maxR2) maxR2 = r2;
    }
    return Math.sqrt(maxR2);
  }

  createCurve() {
    const curve = new THREE.CatmullRomCurve3(this.controlPoints, true, "centripetal");
    curve.arcLengthDivisions = Math.max(1200, this.controlPoints.length * 48);
    return curve;
  }

  initControlPoints(randomize = false) {
    const { anchors } = CIRCUIT_LAYOUTS[this.layoutKey];
    const variation = (this.curveStrength - 0.45) * 6;
    const mirror = randomize && Math.random() < 0.5 ? -1 : 1;
    this.controlPoints = anchors.map(([x, z], i) => {
      // Keep the start straight stable and shape the remaining turns.
      const bend = i < 3 ? 0 : variation * Math.sin(i * 1.7);
      const jitter = randomize && i >= 3 ? (Math.random() - 0.5) * 5 : 0;
      return new THREE.Vector3(x, 0.05, (z + bend + jitter) * mirror);
    });
  }

  loadF1Preset(presetKey) {
    if (!Object.hasOwn(CIRCUIT_LAYOUTS, presetKey)) return;
    this.layoutKey = presetKey;
    this.initControlPoints();
    this.build3DHandles();
    const targetMeters = CIRCUIT_LAYOUTS[presetKey].length;
    this.scaleTrackToTargetLength(targetMeters);

    // Sync UI elements to preset length
    const sSlider = $("scaleSlider");
    const sInput = $("lengthInput");
    const sOut = $("scaleOut");
    const sLenDisp = $("trackLengthDisplay");
    if (sSlider) sSlider.value = targetMeters;
    if (sInput) sInput.value = targetMeters;
    if (sOut) sOut.value = `${targetMeters.toLocaleString()} m (${(targetMeters / 1000).toFixed(2)} km)`;
    if (sLenDisp) sLenDisp.textContent = `${targetMeters.toLocaleString()} m`;

    if (this.app) {
      this.app.reset();
    }
  }

  randomize() {
    this.curveStrength = 0.35 + Math.random() * 0.4;
    $("curveSlider").value = this.curveStrength.toFixed(2);
    $("curveOut").value = this.curveStrength.toFixed(2);

    const layouts = Object.keys(CIRCUIT_LAYOUTS).filter(key => key !== this.layoutKey);
    this.layoutKey = layouts[Math.floor(Math.random() * layouts.length)];
    this.initControlPoints(true);
    this.build3DHandles();
    this.scaleTrackToTargetLength(this.targetLength);
  }

  setStressGeometry(dense) {
    this.denseStressMode = dense;
    this.rebuildTrackFromPoints();
  }

  setHairpinStress() {
    this.curveStrength = 0.85;
    $("curveSlider").value = "0.85";
    $("curveOut").value = "0.85";
    const baseRx = 88 * this.lengthScale;
    const baseRz = 48 * this.lengthScale;
    this.controlPoints = [];
    const anchorCount = 13;
    for (let i = 0; i < anchorCount; i++) {
      const angle = (i / anchorCount) * Math.PI * 2;
      const zigzag = i % 2 === 0 ? 1.35 : 0.65;
      const x = Math.cos(angle) * baseRx * zigzag;
      const z = Math.sin(angle) * baseRz * (i % 3 === 0 ? 1.4 : 0.7);
      this.controlPoints.push(new THREE.Vector3(x, 0.05, z));
    }
    this.build3DHandles();
    this.scaleTrackToTargetLength(this.targetLength);
  }

  toggleEditHandles() {
    this.editHandlesVisible = !this.editHandlesVisible;
    this.handleGroup.visible = this.editHandlesVisible;
    const btn = $("btnEditHandles");
    if (btn) btn.classList.toggle("active", this.editHandlesVisible);
    const notice = $("handleNotice");
    if (notice) notice.classList.toggle("visible", this.editHandlesVisible);
  }

  scaleTrack(factor) {
    let cx = 0;
    let cz = 0;
    for (const p of this.controlPoints) {
      cx += p.x;
      cz += p.z;
    }
    cx /= this.controlPoints.length;
    cz /= this.controlPoints.length;

    for (const p of this.controlPoints) {
      p.x = cx + (p.x - cx) * factor;
      p.z = cz + (p.z - cz) * factor;
    }

    this.updateAllHandleVisuals();
    this.rebuildTrackFromPoints();
  }

  moveAnchor(index, newX, newZ) {
    if (!this.controlPoints[index]) return;
    this.controlPoints[index].x = newX;
    this.controlPoints[index].z = newZ;

    const h = this.handleObjects[index];
    if (h) {
      h.sphere.position.set(newX, 1.2, newZ);
      h.ring.position.set(newX, 0.04, newZ);
      const stemPos = h.stem.geometry.attributes.position.array;
      stemPos[0] = newX;
      stemPos[1] = 0.04;
      stemPos[2] = newZ;
      stemPos[3] = newX;
      stemPos[4] = 1.2;
      stemPos[5] = newZ;
      h.stem.geometry.attributes.position.needsUpdate = true;
      if (h.pickProxy) {
        h.pickProxy.position.set(newX, 1.2, newZ);
      }
    }

    this.rebuildTrackFromPoints();
  }

  highlightHandle(index, active, hover) {
    const h = this.handleObjects[index];
    if (!h) return;
    h.userData = h.userData || {};
    h.userData.active = active;
    h.userData.hover = hover;

    if (active) {
      h.sphere.material.color.setHex(0xffe600);
      h.sphere.material.emissive.setHex(0xffaa00);
      h.sphere.material.emissiveIntensity = 1.4;
      h.ring.material.color.setHex(0xffe600);
    } else if (hover) {
      h.sphere.material.color.setHex(0x00ffee);
      h.sphere.material.emissive.setHex(0x00ffee);
      h.sphere.material.emissiveIntensity = 1.0;
      h.ring.material.color.setHex(0x00ffee);
    } else {
      h.sphere.material.color.setHex(0x0078d4);
      h.sphere.material.emissive.setHex(0x004578);
      h.sphere.material.emissiveIntensity = 0.7;
      h.ring.material.color.setHex(0x0078d4);
    }
  }

  build3DHandles() {
    disposeGroupContents(this.handleGroup);
    this.handleObjects = [];
    this.handleMeshes = [];

    const sphereGeom = new THREE.SphereGeometry(0.55, 24, 24);
    const ringGeom = new THREE.RingGeometry(0.65, 0.95, 32);

    for (let i = 0; i < this.controlPoints.length; i++) {
      const p = this.controlPoints[i];

      const sphereMat = new THREE.MeshStandardMaterial({
        color: 0x0078d4,
        emissive: 0x004578,
        emissiveIntensity: 0.7,
        roughness: 0.2,
        metalness: 0.85,
      });

      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      sphere.position.set(p.x, 1.2, p.z);
      sphere.castShadow = true;
      sphere.userData = { anchorIndex: i, isHandle: true };
      this.handleGroup.add(sphere);

      const proxyGeom = new THREE.SphereGeometry(2.4, 8, 8);
      const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
      const pickProxy = new THREE.Mesh(proxyGeom, proxyMat);
      pickProxy.position.set(p.x, 1.2, p.z);
      pickProxy.userData = { anchorIndex: i, isHandle: true };
      this.handleGroup.add(pickProxy);
      this.handleMeshes.push(pickProxy);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x0078d4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.04, p.z);
      this.handleGroup.add(ring);

      const stemGeom = new THREE.BufferGeometry();
      const stemPts = new Float32Array([p.x, 0.04, p.z, p.x, 1.2, p.z]);
      stemGeom.setAttribute("position", new THREE.BufferAttribute(stemPts, 3));
      const stemMat = new THREE.LineBasicMaterial({
        color: 0x0078d4,
        transparent: true,
        opacity: 0.75,
        linewidth: 2,
      });
      const stem = new THREE.Line(stemGeom, stemMat);
      this.handleGroup.add(stem);

      this.handleObjects.push({ sphere, ring, stem, pickProxy });
    }

    this.handleGroup.visible = this.editHandlesVisible;
  }

  updateAllHandleVisuals() {
    for (let i = 0; i < this.controlPoints.length; i++) {
      const p = this.controlPoints[i];
      const h = this.handleObjects[i];
      if (h) {
        h.sphere.position.set(p.x, 1.2, p.z);
        h.ring.position.set(p.x, 0.04, p.z);
        if (h.pickProxy) h.pickProxy.position.set(p.x, 1.2, p.z);
        const stemPos = h.stem.geometry.attributes.position.array;
        stemPos[0] = p.x;
        stemPos[1] = 0.04;
        stemPos[2] = p.z;
        stemPos[3] = p.x;
        stemPos[4] = 1.2;
        stemPos[5] = p.z;
        h.stem.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  updateHandleScales(camera) {
    if (!this.editHandlesVisible || !camera) return;
    const camPos = camera.position;
    for (let i = 0; i < this.handleObjects.length; i++) {
      const h = this.handleObjects[i];
      if (!h || !h.sphere) continue;
      const dist = camPos.distanceTo(h.sphere.position);
      const baseScale = Math.max(0.4, dist * 0.007);
      const activeScale = h.userData && h.userData.hover ? 1.25 : (h.userData && h.userData.active ? 1.4 : 1.0);
      const finalScale = baseScale * activeScale;
      h.sphere.scale.setScalar(finalScale);
      h.ring.scale.setScalar(finalScale);
      h.pickProxy.scale.setScalar(finalScale);
    }
  }

  rebuildTrackFromPoints() {
    disposeGroupContents(this.trackGroup, [this.matLightOff, this.matLightRed, this.matLightGreen]);
    this.activePathOffsets = null;
    this.curve = this.createCurve();
    this.totalLength = Math.round(this.curve.getLength());
    this.sampleCount = Math.max(360, Math.min(this.denseStressMode ? 2000 : 1000, Math.round(this.totalLength / (this.denseStressMode ? 4 : 8))));

    this.samples = [];
    for (let i = 0; i < this.sampleCount; i++) {
      const t = i / this.sampleCount;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      this.samples.push({
        index: i,
        position: pos,
        tangent: tangent,
        normal: normal,
        curvature: 0,
        signedCurvature: 0,
      });
    }

    for (let i = 0; i < this.sampleCount; i++) {
      const curr = this.samples[i];
      const next = this.samples[(i + 1) % this.sampleCount];
      const t0 = curr.tangent;
      const t1 = next.tangent;
      const ds = curr.position.distanceTo(next.position) || 1;
      const cross = t0.x * t1.z - t0.z * t1.x;
      curr.signedCurvature = cross / ds;
      curr.curvature = Math.abs(cross) / ds;
    }

    this.totalLength = this.curve.getLength();

    // Geometric Shortest Path Base Racing Line:
    // Pure 0.0 offset on all straights (zero turning, zero swerving);
    // Smooth progressive inside apex clipping only through genuine corners.
    this.baseRacingLineOffsets = new Float32Array(this.sampleCount);
    const maxApexClip = 1.35; // Gentle, smooth apex clipping (no violent lateral diving)
    for (let i = 0; i < this.sampleCount; i++) {
      const curr = this.samples[i];
      if (curr.curvature > 0.009) {
        const t = Math.min(1.0, (curr.curvature - 0.009) / (0.022 - 0.009));
        const smooth = t * t * (3 - 2 * t);
        const turnDir = Math.sign(curr.signedCurvature);
        this.baseRacingLineOffsets[i] = turnDir * maxApexClip * smooth;
      } else {
        this.baseRacingLineOffsets[i] = 0.0; // PURE STRAIGHT
      }
    }

    // Anchor start/finish grid (offset = 0) so car starts dead straight
    const startMargin = Math.floor(this.sampleCount * 0.06);
    for (let i = 0; i < startMargin; i++) {
      const blend = i / startMargin;
      this.baseRacingLineOffsets[i] *= blend;
      this.baseRacingLineOffsets[this.sampleCount - 1 - i] *= blend;
    }
    this.baseRacingLineOffsets[0] = 0.0;

    for (let pass = 0; pass < 24; pass++) {
      const smoothed = new Float32Array(this.sampleCount);
      for (let i = 0; i < this.sampleCount; i++) {
        const prev = this.baseRacingLineOffsets[(i - 1 + this.sampleCount) % this.sampleCount];
        const curr = this.baseRacingLineOffsets[i];
        const next = this.baseRacingLineOffsets[(i + 1) % this.sampleCount];
        smoothed[i] = prev * 0.25 + curr * 0.5 + next * 0.25;
      }
      this.baseRacingLineOffsets = smoothed;
    }
    this.baseRacingLineOffsets[0] = 0.0;

    this.buildRoadMesh();
    this.buildCurbs();
    this.buildGrassVerges();
    this.buildGravelTraps();
    this.buildGuardRails();
    this.buildStartGantry();
    this.buildFinishFlag();
    this.buildAudienceAndGrandstands();
    this.buildOverlays();

    if (this.app && this.app.updateEnvironmentForTrack) {
      this.app.updateEnvironmentForTrack(this.getBoundingRadius(), this.totalLength);
    }

    if (this.app && this.app.driverAI) {
      this.app.driverAI.startLap(this.app.currentLap || 1, this);
    }
  }

  updateRacingLineMesh(offsets) {
    if (!this.racingLineMesh || !offsets) return;
    this.activePathOffsets = offsets;
  }

  getLapOffset(progress) {
    if (!this.activePathOffsets || this.activePathOffsets.length === 0) {
      return this.getRacingLineOffset(progress);
    }
    const wrapped = ((progress % 1) + 1) % 1;
    const idxFloat = wrapped * this.sampleCount;
    const idx0 = Math.floor(idxFloat) % this.sampleCount;
    const idx1 = (idx0 + 1) % this.sampleCount;
    const frac = idxFloat - Math.floor(idxFloat);
    const smoothFrac = frac * frac * (3 - 2 * frac);
    return THREE.MathUtils.lerp(this.activePathOffsets[idx0], this.activePathOffsets[idx1], smoothFrac);
  }

  getPathPosition(progress, targetVec) {
    const wrapped = ((progress % 1) + 1) % 1;
    this.curve.getPointAt(wrapped, targetVec);
    const off = this.getLapOffset(wrapped);
    if (Math.abs(off) > 0.0001) {
      this.curve.getTangentAt(wrapped, _scratchTangent).normalize();
      _scratchNormal.set(-_scratchTangent.z, 0, _scratchTangent.x);
      targetVec.addScaledVector(_scratchNormal, off);
    }
    return targetVec;
  }

  getPathCurvature(progress) {
    const d = Math.max(2, this.totalLength / this.sampleCount) / this.totalLength;
    this.getPathPosition(progress - d, _pPrev);
    this.getPathPosition(progress, _pCurr);
    this.getPathPosition(progress + d, _pNext);

    _vA.subVectors(_pCurr, _pPrev);
    _vB.subVectors(_pNext, _pCurr);

    const lenA = _vA.length();
    const lenB = _vB.length();
    if (lenA < 0.001 || lenB < 0.001) return 0.001;

    _crossVec.crossVectors(_vA, _vB);
    const crossLen = _crossVec.length();
    const lenC = _vC.subVectors(_pNext, _pPrev).length();
    if (lenC < 0.001) return 0.001;

    const kappa = (2 * crossLen) / (lenA * lenB * lenC);
    return Math.max(0, kappa);
  }

  getRacingLineOffset(progress) {
    if (!this.baseRacingLineOffsets || this.baseRacingLineOffsets.length === 0) return 0;
    const wrapped = ((progress % 1) + 1) % 1;
    const idxFloat = wrapped * this.sampleCount;
    const idx0 = Math.floor(idxFloat) % this.sampleCount;
    const idx1 = (idx0 + 1) % this.sampleCount;
    const frac = idxFloat - Math.floor(idxFloat);
    const smoothFrac = frac * frac * (3 - 2 * frac);
    return THREE.MathUtils.lerp(this.baseRacingLineOffsets[idx0], this.baseRacingLineOffsets[idx1], smoothFrac);
  }

  getTrajectoryHeading(progress) {
    const ds = 5 / this.totalLength; // Five-meter heading baseline on any circuit size
    this.getPathPosition(progress - ds, _hPrev);
    this.getPathPosition(progress + ds, _hNext);
    _trajectoryVec.subVectors(_hNext, _hPrev);
    _trajectoryVec.y = 0;
    if (_trajectoryVec.lengthSq() < 1e-8) {
      const wrapped = ((progress % 1) + 1) % 1;
      this.curve.getTangentAt(wrapped, _scratchTangent);
      return Math.atan2(_scratchTangent.x, _scratchTangent.z);
    }
    _trajectoryVec.normalize();
    return Math.atan2(_trajectoryVec.x, _trajectoryVec.z);
  }

  buildRoadMesh() {
    const halfW = this.roadWidth / 2;
    const tileLength = Math.max(1, Math.round(this.totalLength / 2.5));
    const vertices = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i <= this.sampleCount; i++) {
      const s = this.samples[i % this.sampleCount];
      const left = s.position.clone().addScaledVector(s.normal, -halfW);
      const right = s.position.clone().addScaledVector(s.normal, halfW);

      vertices.push(left.x, left.y, left.z);
      vertices.push(right.x, right.y, right.z);

      const vProg = (i / this.sampleCount) * tileLength;
      uvs.push(0, vProg);
      uvs.push(this.roadWidth / 2.5, vProg);

      if (i < this.sampleCount) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      map: createAsphaltTexture(),
      roughness: 0.94,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.roadMesh = new THREE.Mesh(geom, roadMat);
    this.roadMesh.receiveShadow = true;
    this.trackGroup.add(this.roadMesh);

    // Paint the edges at their physical width so they don't shimmer as screen-space lines.
    const paintVertices = [], paintIndices = [];
    for (const side of [-1, 1]) {
      const first = paintVertices.length / 3;
      for (let i = 0; i <= this.sampleCount; i++) {
        const { position, normal } = this.samples[i % this.sampleCount];
        for (const width of [halfW - 0.47, halfW - 0.25]) {
          paintVertices.push(position.x + normal.x * width * side, position.y + 0.018, position.z + normal.z * width * side);
        }
        if (i === this.sampleCount) continue;
        const a = first + i * 2;
        if (side > 0) paintIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else paintIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const paintGeometry = new THREE.BufferGeometry();
    paintGeometry.setAttribute("position", new THREE.Float32BufferAttribute(paintVertices, 3));
    paintGeometry.setIndex(paintIndices);
    paintGeometry.computeVertexNormals();
    const paint = new THREE.Mesh(paintGeometry, new THREE.MeshStandardMaterial({ color: 0xdfded3, roughness: 0.96 }));
    paint.name = "Track edge paint";
    paint.receiveShadow = true;
    this.trackGroup.add(paint);
  }

  buildCurbs() {
    const halfW = this.roadWidth / 2;
    const curbW = 1.35;
    const curbH = 0.16;
    const stripePairs = Math.max(1, Math.round(this.totalLength / 8));
    const material = new THREE.MeshStandardMaterial({
      map: createCurbTexture(),
      roughness: 0.82,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const buildCurbStrip = (side) => {
      const geom = new THREE.BufferGeometry();
      const vertices = [];
      const uvs = [];
      const indices = [];

      for (let i = 0; i <= this.sampleCount; i++) {
        const s = this.samples[i % this.sampleCount];
        const inner = s.position.clone().addScaledVector(s.normal, side * halfW);
        const outer = s.position.clone().addScaledVector(s.normal, side * (halfW + curbW));

        inner.y += 0.02;
        outer.y += curbH;

        vertices.push(inner.x, inner.y, inner.z);
        vertices.push(outer.x, outer.y, outer.z);

        const u = i / this.sampleCount * stripePairs;
        uvs.push(u, 0, u, 1);

        if (i < this.sampleCount) {
          const base = i * 2;
          if (side > 0) {
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
          } else {
            indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          }
        }
      }

      geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geom.setIndex(indices);
      geom.computeVertexNormals();

      const mesh = new THREE.Mesh(geom, material);
      mesh.receiveShadow = true;
      this.trackGroup.add(mesh);
    };

    buildCurbStrip(-1);
    buildCurbStrip(1);
  }

  buildGrassVerges() {
    const colors = [0x70724b, 0x6c7045, 0x59683b, 0x4e5e31, 0x5a6b3c, 0x4a5a30, 0x526337, 0x465b30]
      .map(hex => new THREE.Color(hex));
    const widths = [0, 1.1, 2.5, 4.2, 6.8, 9.1, 12.7, 17];
    const edge = this.roadWidth / 2 + 1.35;
    const vertices = [], vertexColors = [], indices = [];
    for (const side of [-1, 1]) {
      const first = vertices.length / 3;
      for (let i = 0; i <= this.sampleCount; i++) {
        const { position, normal, signedCurvature } = this.samples[i % this.sampleCount];
        const phase = 2 * Math.PI * i / this.sampleCount;
        const spread = 1 + Math.sin(phase * 9 + side) * 0.12 + Math.sin(phase * 17) * 0.07;
        const insideLimit = signedCurvature * side > 0 ? Math.max(0.4, 0.8 / Math.abs(signedCurvature) - edge) : Infinity;
        const scale = Math.min(spread, insideLimit / widths.at(-1));
        for (let j = 0; j < widths.length; j++) {
          const offset = side * (edge + widths[j] * scale);
          vertices.push(position.x + normal.x * offset, 0.014, position.z + normal.z * offset);
          const color = colors[j];
          vertexColors.push(color.r, color.g, color.b, j === widths.length - 1 ? 0 : 1);
          if (i === this.sampleCount || j === widths.length - 1) continue;
          const a = first + i * widths.length + j;
          const b = a + 1, c = a + widths.length, d = c + 1;
          if (side > 0) indices.push(a, b, c, b, d, c);
          else indices.push(a, c, b, b, c, d);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 1 });
    const verge = new THREE.Mesh(geometry, material);
    verge.name = "Mown grass verges";
    verge.receiveShadow = true;
    this.trackGroup.add(verge);
  }

  buildGravelTraps() {
    const edge = this.roadWidth / 2 + 1.35;
    const vertices = [], indices = [];
    for (const side of [-1, 1]) {
      const start = vertices.length / 3;
      const widths = this.samples.map(s => 6.5 * THREE.MathUtils.smoothstep(-side * s.signedCurvature, 0.004, 0.013));
      for (let i = 0; i <= this.sampleCount; i++) {
        const index = i % this.sampleCount;
        const { position, normal } = this.samples[index];
        for (const distance of [edge, edge + widths[index]]) {
          const offset = side * distance;
          vertices.push(position.x + normal.x * offset, position.y - 0.02, position.z + normal.z * offset);
        }
        if (i === this.sampleCount || widths[index] + widths[(i + 1) % this.sampleCount] === 0) continue;
        const a = start + i * 2;
        if (side > 0) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    if (!indices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0xb79a73, roughness: 0.95 });
    const gravel = new THREE.Mesh(geometry, material);
    gravel.name = "Gravel runoff";
    gravel.receiveShadow = true;
    this.trackGroup.add(gravel);
  }

  buildGuardRails() {
    const halfW = this.roadWidth / 2 + 1.8;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, metalness: 0.75, roughness: 0.35 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8a9ba8, metalness: 0.85, roughness: 0.25 });
    const step = this.denseStressMode ? 2 : 4;
    const samples = this.samples.filter((s, i) => i % step === 0 && (s.curvature > 0.004 || this.denseStressMode));
    if (!samples.length) {
      postMat.dispose();
      railMat.dispose();
      return;
    }
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1.3, 0.22), postMat, samples.length * 2);
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.45, 5.0), railMat, samples.length * 2);
    const transform = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let index = 0;
    for (const sample of samples) {
      for (const side of [-1, 1]) {
        position.copy(sample.position).addScaledVector(sample.normal, side * halfW);
        position.y += 0.65;
        posts.setMatrixAt(index, transform.makeTranslation(position.x, position.y, position.z));
        position.y += 0.05;
        transform.makeRotationY(Math.atan2(sample.tangent.x, sample.tangent.z)).setPosition(position);
        rails.setMatrixAt(index++, transform);
      }
    }
    posts.name = "Guardrail posts";
    rails.name = "Guardrail panels";
    posts.castShadow = true;
    this.trackGroup.add(posts, rails);
  }

  buildStartGantry() {
    const s0 = this.samples[0];
    const gantryGroup = new THREE.Group();
    gantryGroup.name = "Start / Finish Gantry";
    // Place the bridge just ahead of the timing line so it clears the car on the grid.
    const bridgeProgress = 6 / this.totalLength;
    this.curve.getPointAt(bridgeProgress, gantryGroup.position);
    this.gantryPosition = gantryGroup.position;
    const bridgeTangent = this.curve.getTangentAt(bridgeProgress, _scratchTangent);
    gantryGroup.rotation.y = Math.atan2(bridgeTangent.x, bridgeTangent.z);

    const pillarX = this.roadWidth / 2 + 2.8;
    const beamWidth = pillarX * 2 + 0.85;
    const structure = new THREE.MeshStandardMaterial({ color: 0x263849, metalness: 0.25, roughness: 0.55 });
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xa7b5c2, roughness: 0.82 });
    const accent = new THREE.MeshBasicMaterial({ color: 0x62e3df, toneMapped: false });
    const signalHousing = new THREE.MeshStandardMaterial({ color: 0x121c29, roughness: 0.65 });
    const box = (name, width, height, depth, material, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      gantryGroup.add(mesh);
      return mesh;
    };

    for (const side of [-1, 1]) {
      const x = side * pillarX;
      box("Pylon base", 1.45, 0.45, 1.45, baseMaterial, x, 0.225, 0);
      box("Gantry pylon", 0.88, 7.15, 0.86, structure, x, 3.575, 0).castShadow = true;
      box("Pylon accent", 0.12, 5.7, 0.04, accent, x, 3.65, -0.45);
      box("Timing marker", 0.46, 1.1, 0.54, structure, side * (this.roadWidth / 2 + 1.7), 0.55, 0);
      box("Timing marker lens", 0.48, 0.18, 0.56, accent, side * (this.roadWidth / 2 + 1.7), 1.06, 0);
    }

    box("Gantry crossbeam", beamWidth, 2.2, 0.96, structure, 0, 6.65, 0);
    box("Upper accent", beamWidth + 0.1, 0.08, 1.02, accent, 0, 7.81, 0);
    box("Lower rail", beamWidth + 0.1, 0.18, 1.02, baseMaterial, 0, 5.45, 0);

    const bannerMat = new THREE.MeshBasicMaterial({ map: createGantryBannerTexture(), toneMapped: false });
    const bannerGeom = new THREE.PlaneGeometry(Math.min(beamWidth - 1.3, 12.4), 2.04);
    for (const side of [-1, 1]) {
      const banner = new THREE.Mesh(bannerGeom, bannerMat);
      banner.name = side < 0 ? "Start / Finish approach sign" : "Start / Finish reverse sign";
      banner.position.set(0, 6.65, side * 0.49);
      banner.rotation.y = side < 0 ? Math.PI : 0;
      gantryGroup.add(banner);
    }

    // Keep the five race signals centered below the sign and facing the grid.
    this.matLightOff = new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 0.85, metalness: 0.2 });
    this.matLightRed = new THREE.MeshStandardMaterial({
      color: 0xff1744,
      emissive: 0xff1744,
      emissiveIntensity: 3.5,
      roughness: 0.1,
    });
    this.matLightGreen = new THREE.MeshStandardMaterial({
      color: 0x00e676,
      emissive: 0x00e676,
      emissiveIntensity: 4.0,
      roughness: 0.1,
    });

    box("Start light housing", 4.28, 0.78, 0.4, signalHousing, 0, 5.04, -0.2);
    this.startLightMeshes = [];
    const lens = new THREE.CylinderGeometry(0.14, 0.14, 0.09, 16).rotateX(Math.PI / 2);
    for (let k = -2; k <= 2; k++) {
      const top = new THREE.Mesh(lens, this.matLightOff);
      const bot = new THREE.Mesh(lens, this.matLightOff);
      top.position.set(k * 0.75, 5.19, -0.43);
      bot.position.set(k * 0.75, 4.89, -0.43);
      gantryGroup.add(top, bot);
      this.startLightMeshes.push({ top, bot });
    }

    const finish = new THREE.Mesh(
      new THREE.PlaneGeometry(this.roadWidth, 2.1),
      new THREE.MeshBasicMaterial({ map: createCheckeredFinishTexture(), toneMapped: false }),
    );
    finish.name = "Start / Finish timing stripe";
    finish.geometry.rotateX(-Math.PI / 2);
    finish.rotation.y = Math.atan2(s0.tangent.x, s0.tangent.z);
    finish.position.copy(s0.position);
    finish.position.y += 0.035;

    const paint = new THREE.MeshBasicMaterial({ color: 0xf4f8fc, toneMapped: false });
    const crossbar = new THREE.PlaneGeometry(2.55, 0.13).rotateX(-Math.PI / 2);
    const sideBar = new THREE.PlaneGeometry(0.13, 2).rotateX(-Math.PI / 2);
    const gridPositions = new THREE.Group();
    gridPositions.name = "Starting grid";
    for (let index = 1; index <= 6; index++) {
      const grid = new THREE.Group();
      const side = index % 2 ? -1 : 1;
      const progress = 1 - index * 8 / this.totalLength;
      const tangent = this.curve.getTangentAt(progress, _scratchTangent);
      const normal = _scratchNormal.set(-tangent.z, 0, tangent.x).normalize();
      this.curve.getPointAt(progress, grid.position);
      grid.position.addScaledVector(normal, side * this.roadWidth * 0.23);
      grid.position.y += 0.03;
      grid.rotation.y = Math.atan2(tangent.x, tangent.z);
      const front = new THREE.Mesh(crossbar, paint);
      const left = new THREE.Mesh(sideBar, paint);
      const right = new THREE.Mesh(sideBar, paint);
      front.position.z = 1;
      left.position.x = -1.21;
      right.position.x = 1.21;
      grid.add(front, left, right);
      gridPositions.add(grid);
    }
    this.trackGroup.add(gantryGroup, finish, gridPositions);
  }

  setGantryLights(mode, redCount = 0) {
    if (!this.startLightMeshes || this.startLightMeshes.length === 0) return;
    for (let i = 0; i < this.startLightMeshes.length; i++) {
      const pod = this.startLightMeshes[i];
      let mat = this.matLightOff;
      if (mode === "ALL_RED") {
        mat = this.matLightRed;
      } else if (mode === "RED_COUNT") {
        mat = (i < redCount) ? this.matLightRed : this.matLightOff;
      } else if (mode === "GREEN") {
        mat = this.matLightGreen;
      } else if (mode === "OFF") {
        mat = this.matLightOff;
      }
      pod.top.material = mat;
      pod.bot.material = mat;
    }
  }

  buildFinishFlag() {
    const s0 = this.samples[0];
    const halfW = this.roadWidth / 2;

    // Finish flag group located directly on the LEFT side of the start/finish line
    const flagGroup = new THREE.Group();
    flagGroup.position.copy(s0.position);
    flagGroup.rotation.y = Math.atan2(s0.tangent.x, s0.tangent.z);

    const leftX = -halfW - 1.2; // Right beside the left curb, fully visible to driver!

    // 1. Marshall elevated platform tower
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    const safetyRailMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.6, roughness: 0.3 });
    const platformGeom = new THREE.BoxGeometry(2.6, 0.25, 2.6);
    const platform = new THREE.Mesh(platformGeom, platformMat);
    platform.position.set(leftX - 0.8, 1.8, 0);
    platform.castShadow = true;
    flagGroup.add(platform);

    // 4 legs for the tower
    for (let lx = -1.1; lx <= 1.1; lx += 2.2) {
      for (let lz = -1.1; lz <= 1.1; lz += 2.2) {
        const legGeom = new THREE.CylinderGeometry(0.08, 0.1, 1.8, 8);
        const leg = new THREE.Mesh(legGeom, platformMat);
        leg.position.set(leftX - 0.8 + lx, 0.9, lz);
        flagGroup.add(leg);
      }
    }

    // Handrails around platform
    const railGeom = new THREE.BoxGeometry(2.6, 0.08, 0.08);
    const railFront = new THREE.Mesh(railGeom, safetyRailMat);
    railFront.position.set(leftX - 0.8, 2.7, 1.25);
    flagGroup.add(railFront);
    const railBack = new THREE.Mesh(railGeom, safetyRailMat);
    railBack.position.set(leftX - 0.8, 2.7, -1.25);
    flagGroup.add(railBack);

    // 2. High-vis Race Marshall 3D Figurine standing on the platform
    const marshallGroup = new THREE.Group();
    marshallGroup.position.set(leftX - 0.4, 1.95, 0);

    const suitMat = new THREE.MeshStandardMaterial({ color: 0xff5500, roughness: 0.5 }); // FIA High-vis Orange
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf5cba7, roughness: 0.8 });

    // Marshall body & legs (Human scale)
    const bodyGeom = new THREE.BoxGeometry(0.5, 0.75, 0.35);
    const body = new THREE.Mesh(bodyGeom, suitMat);
    body.position.y = 1.0;
    marshallGroup.add(body);

    const legGeom = new THREE.CylinderGeometry(0.11, 0.11, 0.65, 8);
    const leftLeg = new THREE.Mesh(legGeom, suitMat);
    leftLeg.position.set(-0.14, 0.35, 0);
    marshallGroup.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeom, suitMat);
    rightLeg.position.set(0.14, 0.35, 0);
    marshallGroup.add(rightLeg);

    // Marshall head & helmet
    const headGeom = new THREE.SphereGeometry(0.2, 12, 12);
    const head = new THREE.Mesh(headGeom, whiteMat);
    head.position.y = 1.55;
    marshallGroup.add(head);

    // Waving Arm holding flagpole
    const armPivot = new THREE.Group();
    armPivot.position.set(0.28, 1.25, 0);
    const armGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8);
    const armMesh = new THREE.Mesh(armGeom, suitMat);
    armMesh.position.set(0.25, 0.15, 0);
    armMesh.rotation.z = -Math.PI / 4;
    armPivot.add(armMesh);
    marshallGroup.add(armPivot);
    this.flagMarshallArm = armPivot;

    flagGroup.add(marshallGroup);

    // 3. Main Steel Flagpole (Height 6.8m, angled slightly towards track)
    const poleGeom = new THREE.CylinderGeometry(0.08, 0.1, 6.8, 12);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xccd6dd, metalness: 0.9, roughness: 0.2 });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.set(leftX, 4.2, 0);
    pole.rotation.z = -0.08;
    pole.castShadow = true;
    flagGroup.add(pole);

    // Gold Finial ball
    const finialGeom = new THREE.SphereGeometry(0.2, 12, 12);
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.95, roughness: 0.15 });
    const finial = new THREE.Mesh(finialGeom, goldMat);
    finial.position.set(leftX - 0.25, 7.6, 0);
    flagGroup.add(finial);

    // Double-sided checkered cloth remains readable from either direction.
    const flagW = 3.8;
    const flagH = 1.9;
    const flagGeom = new THREE.PlaneGeometry(flagW, flagH, 36, 18);
    // Anchor left edge at pole (x = 0 at pole, extends towards +X)
    flagGeom.translate(flagW / 2, 0, 0);

    const flagTex = createFinishFlagTexture();
    const flagMat = new THREE.MeshStandardMaterial({
      map: flagTex,
      side: THREE.DoubleSide,
      roughness: 0.35,
      metalness: 0.15,
    });
    const flagMesh = new THREE.Mesh(flagGeom, flagMat);
    flagMesh.position.set(leftX, 4.8, 0);
    flagMesh.rotation.y = 0.2;
    flagMesh.castShadow = true;
    flagGroup.add(flagMesh);

    this.finishFlagMesh = flagMesh;
    this.flagGeom = flagGeom;
    this.flagWidth = flagW;
    this.flagWaveTime = 0;

    this.trackGroup.add(flagGroup);
  }

  updateFinishFlag(dt, progress, isLapCelebrate) {
    if (!this.flagGeom) return;
    const isNearFinish = (progress > 0.82 || progress < 0.12 || isLapCelebrate);
    const waveSpeed = isNearFinish ? 12.0 : 5.0;
    const waveAmp = isNearFinish ? 0.55 : 0.22;

    this.flagWaveTime = (this.flagWaveTime || 0) + dt * waveSpeed;
    const time = this.flagWaveTime;

    const pos = this.flagGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const ratio = Math.max(0, x / this.flagWidth);
      const wave = Math.sin(x * 2.2 - time) * ratio * waveAmp
                 + Math.cos(y * 2.8 + time * 0.75) * (ratio * ratio) * (waveAmp * 0.4);
      pos.setZ(i, wave);
    }
    pos.needsUpdate = true;
    this.flagGeom.computeVertexNormals();

    if (this.flagMarshallArm) {
      if (isNearFinish) {
        this.flagMarshallArm.rotation.z = Math.sin(time * 1.6) * 0.55 - 0.25;
        this.flagMarshallArm.rotation.x = Math.cos(time * 1.4) * 0.35;
      } else {
        this.flagMarshallArm.rotation.z = Math.sin(time * 0.6) * 0.15 - 0.15;
        this.flagMarshallArm.rotation.x = 0;
      }
    }
  }

  buildAudienceAndGrandstands() {
    this.crowd = new TrackCrowd();

    // Team shirt colors for diverse spectator crowd (Ultra-Vibrant)
    const teamColors = [
      0xff1744, // Ferrari Red
      0x00f2fe, // Mercedes Cyan
      0xff6d00, // McLaren Papaya
      0xffd600, // Red Bull Yellow
      0x00e676, // Aston Martin Green
      0xffffff, // Alpine White
      0x2979ff, // Williams Blue
      0x7c4dff, // Purple
    ];

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x0d47a1, roughness: 0.6 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, side: THREE.DoubleSide });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.25 });
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.4 });
    const grassMoundMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.95 });

    const createSpectator = (x, y, z, side) => ({
      x, y, z, heading: -side * Math.PI / 2,
      shirt: teamColors[Math.floor(Math.random() * teamColors.length)],
      whiteCap: Math.random() < 0.3,
      flag: Math.random() > 0.45,
      seed: Math.random() * 100,
    });

    // Helper: Build Grandstand aligned with track samples
    // Tangent = Z (along track length); Normal = X (across track)
    // Strictly offset outside the track road surface with guaranteed safety clearance
    const halfW = this.roadWidth / 2;
    const grandstandFrontBuffer = 6.0;

    const buildTracksideGrandstand = (progressAnchor, lengthMeters, tiers, side = 1) => {
      const grandstandGroup = new THREE.Group();
      const sCenter = this.getSampleAt(progressAnchor);
      const heading = Math.atan2(sCenter.tangent.x, sCenter.tangent.z);

      grandstandGroup.position.copy(sCenter.position);
      grandstandGroup.rotation.y = heading;

      const tierWidth = 1.35;
      const tierHeight = 0.65;
      const depth = tiers * tierWidth;
      const spectators = [];

      // Tiered steps running along Z (track length)
      // Guaranteed strictly outside the track road width
      for (let t = 0; t < tiers; t++) {
        const stepGeom = new THREE.BoxGeometry(tierWidth, tierHeight, lengthMeters);
        const step = new THREE.Mesh(stepGeom, seatMat);
        const xTier = side * (halfW + grandstandFrontBuffer + t * tierWidth + tierWidth / 2);
        step.position.set(xTier, (t + 0.5) * tierHeight, 0);
        step.receiveShadow = true;
        grandstandGroup.add(step);

        // Populate spectators along Z length
        const spectatorsOnTier = Math.floor(lengthMeters / 1.15);
        for (let sp = 0; sp < spectatorsOnTier; sp++) {
          if (Math.random() > 0.15) { // 85% full grandstand
            const zPos = -lengthMeters / 2 + 1.2 + sp * 1.15 + (Math.random() - 0.5) * 0.2;
            const yPos = (t + 1) * tierHeight;
            spectators.push(createSpectator(xTier, yPos, zPos, side));
          }
        }
      }

      // Overhead Canopy Roof
      const roofH = tiers * tierHeight + 4.2;
      const roofGeom = new THREE.BoxGeometry(depth + 2.5, 0.35, lengthMeters + 2.0);
      const roof = new THREE.Mesh(roofGeom, canopyMat);
      const roofCenterX = side * (halfW + grandstandFrontBuffer + depth / 2);
      roof.position.set(roofCenterX, roofH, 0);
      grandstandGroup.add(roof);

      // Support Columns along rear of grandstand
      const rearColX = side * (halfW + grandstandFrontBuffer + depth);
      for (let pz = -lengthMeters / 2 + 2; pz <= lengthMeters / 2 - 2; pz += 12.0) {
        const pillarGeom = new THREE.CylinderGeometry(0.18, 0.18, roofH, 8);
        const pillar = new THREE.Mesh(pillarGeom, frameMat);
        pillar.position.set(rearColX, roofH / 2, pz);
        grandstandGroup.add(pillar);
      }

      this.crowd.addVenue(grandstandGroup, spectators, true);
      this.trackGroup.add(grandstandGroup);
    };

    // 1. Grandstand 1: Main Straight Grandstand (Right side opposite finish line / control tower)
    buildTracksideGrandstand(0.03, 65, 8, 1);

    // 2. Grandstand 2: Turn 1 Arena Grandstand (Outside of corner 1)
    buildTracksideGrandstand(0.22, 45, 6, -1);

    // 3. Grandstand 3: Mid-Circuit Stadium Section (Outside of back straight)
    buildTracksideGrandstand(0.52, 45, 6, 1);

    // 4. Fixed Field Spectator Viewing Berms (Grassy mounds with crowds watching the race)
    const fieldBermZones = [
      { progress: 0.12, side: -1, count: 28, radius: 8.0 },
      { progress: 0.38, side: 1,  count: 32, radius: 8.5 },
      { progress: 0.65, side: -1, count: 30, radius: 8.5 },
      { progress: 0.88, side: 1,  count: 28, radius: 8.0 },
    ];

    fieldBermZones.forEach((zone) => {
      const s = this.getSampleAt(zone.progress);
      const fieldGroup = new THREE.Group();

      // Absolute safety clearance: center is placed so the inner edge is at least 6.0m away from road edge
      const moundOffsetDist = halfW + 6.0 + zone.radius;
      const centerPos = s.position.clone().addScaledVector(s.normal, zone.side * moundOffsetDist);
      centerPos.y = 0.0;
      fieldGroup.position.copy(centerPos);
      fieldGroup.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);

      // Raised grassy viewing berm / mound
      const moundGeom = new THREE.CylinderGeometry(zone.radius * 0.85, zone.radius, 1.2, 16);
      const mound = new THREE.Mesh(moundGeom, grassMoundMat);
      mound.position.set(0, 0.6, 0);
      mound.receiveShadow = true;
      fieldGroup.add(mound);

      // Spectator safety fence along the trackside edge of the mound
      const fenceX = -zone.side * (zone.radius - 0.8);
      const fenceLength = zone.radius * 1.5;
      for (let fz = -fenceLength / 2; fz <= fenceLength / 2; fz += 2.5) {
        const postGeom = new THREE.CylinderGeometry(0.08, 0.08, 1.3, 8);
        const post = new THREE.Mesh(postGeom, fenceMat);
        post.position.set(fenceX, 1.8, fz);
        fieldGroup.add(post);
      }
      const railGeom = new THREE.BoxGeometry(0.06, 0.08, fenceLength);
      const fenceRail = new THREE.Mesh(railGeom, fenceMat);
      fenceRail.position.set(fenceX, 2.3, 0);
      fieldGroup.add(fenceRail);

      // Crowds of spectators gathered on the grassy mound watching the race
      const spectators = [];
      for (let p = 0; p < zone.count; p++) {
        const zPos = (Math.random() - 0.5) * (fenceLength * 0.85);
        // Positioned safely behind the safety fence on the mound
        const xPos = fenceX - zone.side * (1.2 + Math.random() * (zone.radius * 0.8));
        spectators.push(createSpectator(xPos, 1.2, zPos, zone.side));
      }

      // Add a Marshall Station with orange-suited marshalls
      const marshalGroup = new THREE.Group();
      marshalGroup.position.set(fenceX, 1.2, fenceLength / 2 + 1.5);

      const marshalMat = new THREE.MeshStandardMaterial({ color: 0xff5500, roughness: 0.5 });
      const mBody = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.75, 0.32), marshalMat);
      mBody.position.y = 0.7;
      marshalGroup.add(mBody);

      const mHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), whiteMat);
      mHead.position.y = 1.25;
      marshalGroup.add(mHead);

      // Marshall holding waving safety flag
      const flagMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.4),
        new THREE.MeshBasicMaterial({ color: 0x00e676, side: THREE.DoubleSide })
      );
      flagMesh.position.set(0.35, 1.4, 0);
      marshalGroup.add(flagMesh);

      fieldGroup.add(marshalGroup);
      this.crowd.addVenue(fieldGroup, spectators, false);
      this.trackGroup.add(fieldGroup);
    });
  }

  buildOverlays() {
    // Hidden Racing Line Ribbon (Per requirement: no line AI is following)
    const lineGeom = new THREE.BufferGeometry();
    const linePts = new Float32Array((this.sampleCount + 1) * 3);
    for (let i = 0; i <= this.sampleCount; i++) {
      const idx = i % this.sampleCount;
      const s = this.samples[idx];
      const off = (this.activePathOffsets && this.activePathOffsets[idx]) || (this.baseRacingLineOffsets ? this.baseRacingLineOffsets[idx] : 0);
      linePts[i * 3] = s.position.x + s.normal.x * off;
      linePts[i * 3 + 1] = s.position.y + 0.08;
      linePts[i * 3 + 2] = s.position.z + s.normal.z * off;
    }
    lineGeom.setAttribute("position", new THREE.BufferAttribute(linePts, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x0078d4,
      linewidth: 2,
      transparent: true,
      opacity: 0.0,
      visible: false,
    });
    this.racingLineMesh = new THREE.Line(lineGeom, lineMat);
    this.racingLineMesh.visible = false;
    this.trackGroup.add(this.racingLineMesh);

    // Dynamic Braking Zone Arc
    const brakeGeom = new THREE.BufferGeometry();
    const brakePositions = new Float32Array(30 * 3);
    brakeGeom.setAttribute("position", new THREE.BufferAttribute(brakePositions, 3));
    const brakeMat = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 4, transparent: true, opacity: 0.85 });
    this.brakingZoneMesh = new THREE.Line(brakeGeom, brakeMat);
    this.brakingZoneMesh.frustumCulled = false; // The entire line moves along the circuit.
    this.trackGroup.add(this.brakingZoneMesh);
  }

  updateBrakingZone(carProgress) {
    if (!this.brakingZoneMesh) return;
    const positions = this.brakingZoneMesh.geometry.attributes.position.array;
    const count = 30;
    const startProgress = carProgress + 0.03;
    const endProgress = carProgress + 0.11;

    for (let i = 0; i < count; i++) {
      const t = startProgress + (i / count) * (endProgress - startProgress);
      const index = (t % 1) * this.sampleCount;
      const previous = Math.floor(index);
      const a = this.samples[previous].position;
      const b = this.samples[(previous + 1) % this.sampleCount].position;
      const fraction = index - previous;
      positions[i * 3] = THREE.MathUtils.lerp(a.x, b.x, fraction);
      positions[i * 3 + 1] = THREE.MathUtils.lerp(a.y, b.y, fraction) + 0.12;
      positions[i * 3 + 2] = THREE.MathUtils.lerp(a.z, b.z, fraction);
    }
    this.brakingZoneMesh.geometry.attributes.position.needsUpdate = true;
  }

  getSampleAt(progress) {
    const wrapped = ((progress % 1) + 1) % 1;
    const idx = Math.floor(wrapped * this.sampleCount);
    return this.samples[idx] || this.samples[0];
  }

  getNearestProgress(worldPos, hintProgress = null) {
    const n = this.samples.length;
    if (!n) return 0;
    let bestDistance = Infinity, bestProgress = 0;
    const testSegment = i => {
      const a = this.samples[(i + n) % n].position;
      const b = this.samples[(i + 1 + n) % n].position;
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((worldPos.x - a.x) * dx + (worldPos.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const distance = (worldPos.x - a.x - t * dx) ** 2 + (worldPos.z - a.z - t * dz) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestProgress = (((i + n) % n + t) / n) % 1;
      }
    };
    if (Number.isFinite(hintProgress)) {
      const index = Math.floor(((hintProgress % 1 + 1) % 1) * n);
      for (let i = index - 45; i <= index + 45; i++) testSegment(i);
    }
    // Retain the local branch at crossings; recover globally after a teleport.
    if (bestDistance > Math.max(30, this.roadWidth * 3) ** 2) {
      for (let i = 0; i < n; i++) testSegment(i);
    }
    return bestProgress;
  }

}

/* ==========================================================================
   3D Authentic Formula 1 Car with In-Cockpit Digital Dashboard & Spinning Wheels
   ========================================================================== */

class RaceCar3D {
  constructor(scene) {
    this.scene = scene;
    this.carGroup = new THREE.Group();
    this.scene.add(this.carGroup);

    this.wheelRollGroups = [];
    this.frontWheelSteerGroups = [];
    this.brakeLightMesh = null;
    this.chassisMesh = null;
    this.steeringWheelMesh = null;

    // Physical 3D In-Car Dashboard Canvas & Texture (Ultra-Sharp 1024x512)
    this.dashCanvas = document.createElement("canvas");
    this.dashCanvas.width = 1024;
    this.dashCanvas.height = 512;
    this.dashCtx = this.dashCanvas.getContext("2d");
    this.dashTexture = new THREE.CanvasTexture(this.dashCanvas);
    this.dashTexture.generateMipmaps = true;
    this.dashTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.dashTexture.magFilter = THREE.LinearFilter;
    this.dashTexture.anisotropy = 4;

    this.helmetMesh = null;
    this.visorMesh = null;
    this.brakeHeat = 0.0;
    this.brakeRotorMat = null;

    this.buildModel();
  }

  buildModel() {
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x18222a, roughness: 0.48, metalness: 0.24 });
    const liveryCyanMat = new THREE.MeshStandardMaterial({ color: 0x00dce7, roughness: 0.28, metalness: 0.45 });
    const haloTitaniumMat = new THREE.MeshStandardMaterial({ color: 0x242c38, roughness: 0.25, metalness: 0.95 });
    const darkAeroMat = new THREE.MeshStandardMaterial({ color: 0x182333, roughness: 0.49, metalness: 0.33 });
    this.brakeRotorMat = new THREE.MeshStandardMaterial({
      color: 0x6e7884,
      metalness: 0.9,
      roughness: 0.2,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.0,
    });
    const brakeRotorMat = this.brakeRotorMat;
    const brakeCaliperMat = new THREE.MeshStandardMaterial({ color: 0xff1744, metalness: 0.7, roughness: 0.3 });
    const rimAlloyMat = new THREE.MeshStandardMaterial({ color: 0x3e484e, metalness: 0.52, roughness: 0.31 });

    const chassisGroup = new THREE.Group();
    this.chassisMesh = chassisGroup;
    this.carGroup.add(chassisGroup);

    const addPart = (name, geometry, material, castsShadow = true) => {
      const part = new THREE.Mesh(geometry, material);
      part.name = name;
      part.castShadow = castsShadow;
      chassisGroup.add(part);
      return part;
    };
    const body = (name, stations, material = liveryCyanMat) => addPart(name, sculptBody(stations), material);
    const wing = (name, stations, thickness, camber, material) =>
      addPart(name, shapeAerofoil(stations, thickness, camber), material);

    body("Tapered nose and front monocoque", [
      [0.58, 0, 0.31, 0.34, 0.18], [0.87, 0, 0.33, 0.34, 0.16],
      [1.37, 0, 0.32, 0.29, 0.135], [1.81, 0, 0.28, 0.22, 0.106],
      [2.25, 0, 0.24, 0.155, 0.070], [2.68, 0, 0.21, 0.10, 0.042],
      [2.94, 0, 0.196, 0.063, 0.029], [3.01, 0, 0.193, 0.018, 0.012],
    ]);
    body("Carbon floor and rear diffuser", [
      [-2.22, 0, 0.24, 0.58, 0.039], [-1.68, 0, 0.165, 0.64, 0.038],
      [-0.95, 0, 0.139, 0.90, 0.035], [0.12, 0, 0.137, 0.99, 0.031],
      [0.68, 0, 0.14, 0.89, 0.042], [0.93, 0, 0.16, 0.46, 0.043],
      [1.13, 0, 0.17, 0.32, 0.029],
    ], darkAeroMat);
    body("Cockpit floor", [[-0.23, 0, 0.253, 0.32, 0.044], [0.59, 0, 0.245, 0.32, 0.043]], carbonMat);
    for (const side of [-1, 1]) {
      body("Rounded cockpit surround", [
        [-0.4, side * 0.321, 0.470, 0.1, 0.12], [-0.05, side * 0.344, 0.473, 0.083, 0.095],
        [0.31, side * 0.343, 0.432, 0.078, 0.074], [0.58, side * 0.316, 0.413, 0.075, 0.068],
        [0.79, side * 0.25, 0.400, 0.068, 0.061],
      ]);
    }

    wing("Swept carbon front wing", [
      [-1.18, 3.02, 0.35, 0.185], [-1.06, 3.13, 0.52, 0.135], [-0.69, 3.22, 0.58, 0.124],
      [-0.3, 3.27, 0.55, 0.143], [0, 3.26, 0.51, 0.154], [0.3, 3.27, 0.55, 0.143],
      [0.69, 3.22, 0.58, 0.124], [1.06, 3.13, 0.52, 0.135], [1.18, 3.02, 0.35, 0.185],
    ], 0.036, 0.035, darkAeroMat);
    for (const side of [-1, 1]) {
      const flap = [
        [0.25, 3.01, 0.23, 0.168], [0.5, 2.99, 0.335, 0.218], [0.85, 2.98, 0.35, 0.238],
        [1.03, 2.94, 0.32, 0.260], [1.15, 2.90, 0.25, 0.264],
      ].map(([x, ...station]) => [x * side, ...station]).sort((a, b) => a[0] - b[0]);
      wing("Front wing flap", flap, 0.022, 0.041, liveryCyanMat);
      const plate = addPart("Front wing endplate", shapePanel([
        [-0.32, 0.10], [-0.32, 0.19], [-0.11, 0.33], [0.22, 0.36], [0.33, 0.25], [0.35, 0.115],
      ], 0.027, 0.014), liveryCyanMat);
      plate.rotation.y = Math.PI / 2;
      plate.position.set(side * 1.17, 0, 2.96);
    }

    // 3. Titanium HALO Safety Structure
    const haloGroup = new THREE.Group();
    const haloStrutGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.46, 12);
    const haloStrut = new THREE.Mesh(haloStrutGeom, haloTitaniumMat);
    haloStrut.position.set(0, 0.72, 0.65);
    haloStrut.rotation.x = -0.22;
    haloGroup.add(haloStrut);
    this.haloStrut = haloStrut;

    const haloLoopGeom = new THREE.TorusGeometry(0.38, 0.04, 12, 24, Math.PI);
    const haloLoop = new THREE.Mesh(haloLoopGeom, haloTitaniumMat);
    haloLoop.rotation.x = -Math.PI / 2 + 0.18;
    haloLoop.position.set(0, 0.88, 0.28);
    haloGroup.add(haloLoop);
    chassisGroup.add(haloGroup);

    // 4. Cockpit Seat Backrest (Ergonomic bucket seat back behind driver)
    const seatBackGeom = new THREE.BoxGeometry(0.48, 0.42, 0.08);
    const seatBack = new THREE.Mesh(seatBackGeom, darkAeroMat);
    seatBack.position.set(0, 0.46, -0.04);
    chassisGroup.add(seatBack);

    // Driver Helmet & Visor (References saved to hide during Cockpit 3D POV)
    const helmetGeom = new THREE.SphereGeometry(0.2, 20, 20);
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xffd200, roughness: 0.15, metalness: 0.85 });
    const helmet = new THREE.Mesh(helmetGeom, helmetMat);
    helmet.position.set(0, 0.76, 0.12);
    chassisGroup.add(helmet);
    this.helmetMesh = helmet;

    const visorGeom = new THREE.BoxGeometry(0.22, 0.08, 0.16);
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x111624, roughness: 0.05, metalness: 0.98 });
    const visor = new THREE.Mesh(visorGeom, visorMat);
    visor.position.set(0, 0.76, 0.22);
    chassisGroup.add(visor);
    this.visorMesh = visor;

    // Ergonomic F1 Butterfly Steering Wheel with Integrated LCD Digital Dashboard
    const steerWheelGroup = new THREE.Group();
    steerWheelGroup.position.set(0, 0.52, 0.42);
    steerWheelGroup.rotation.x = -0.18;

    const columnGeom = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 12);
    columnGeom.rotateX(Math.PI / 2);
    const steerColumn = new THREE.Mesh(columnGeom, carbonMat);
    steerColumn.position.set(0, -0.02, 0.07);
    steerWheelGroup.add(steerColumn);

    const wheelBodyGeom = new THREE.BoxGeometry(0.28, 0.13, 0.025);
    const wheelBody = new THREE.Mesh(wheelBodyGeom, carbonMat);
    steerWheelGroup.add(wheelBody);

    // Steering Wheel Integrated 3D LCD Display (Ferrari SF-24 / Mercedes W15 Style)
    const wheelScreenGeom = new THREE.PlaneGeometry(0.25, 0.12);
    wheelScreenGeom.rotateY(Math.PI);
    const wheelScreenMat = new THREE.MeshBasicMaterial({
      map: this.dashTexture,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    const wheelScreenMesh = new THREE.Mesh(wheelScreenGeom, wheelScreenMat);
    wheelScreenMesh.position.set(0, 0.015, -0.016);
    steerWheelGroup.add(wheelScreenMesh);
    this.steeringWheelMesh = steerWheelGroup;
    chassisGroup.add(steerWheelGroup);

    [-0.14, 0.14].forEach((gx) => {
      const gripGeom = new THREE.CylinderGeometry(0.022, 0.022, 0.13, 12);
      const gripMat = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.95, metalness: 0.05 });
      const grip = new THREE.Mesh(gripGeom, gripMat);
      grip.position.set(gx, 0, 0);
      steerWheelGroup.add(grip);
    });

    // Rotary Dials and DRS Buttons on the Steering Wheel
    const dialGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.015, 10);
    dialGeom.rotateX(Math.PI / 2);
    const dialMatYellow = new THREE.MeshBasicMaterial({ color: 0xffd200 });
    const dialMatRed = new THREE.MeshBasicMaterial({ color: 0xff2244 });
    const dialMatCyan = new THREE.MeshBasicMaterial({ color: 0x00f2fe });

    const dialL = new THREE.Mesh(dialGeom, dialMatYellow);
    dialL.position.set(-0.06, -0.028, -0.015);
    steerWheelGroup.add(dialL);

    const dialR = new THREE.Mesh(dialGeom, dialMatCyan);
    dialR.position.set(0.06, -0.028, -0.015);
    steerWheelGroup.add(dialR);

    const btnDRS = new THREE.Mesh(dialGeom, dialMatRed);
    btnDRS.position.set(-0.09, 0.035, -0.015);
    steerWheelGroup.add(btnDRS);

    this.steeringWheelMesh = steerWheelGroup;
    chassisGroup.add(steerWheelGroup);

    for (const side of [-1, 1]) {
      body("Sculpted sidepod", [
        [-1.77, side * 0.30, 0.255, 0.13, 0.09], [-1.35, side * 0.41, 0.28, 0.19, 0.105],
        [-0.89, side * 0.54, 0.349, 0.27, 0.145], [-0.31, side * 0.64, 0.393, 0.31, 0.21],
        [0.27, side * 0.65, 0.429, 0.31, 0.239], [0.61, side * 0.65, 0.434, 0.27, 0.176],
        [0.78, side * 0.63, 0.443, 0.185, 0.11], [0.83, side * 0.62, 0.454, 0.13, 0.075],
      ]);
      body("Sidepod intake", [
        [0.793, side * 0.629, 0.454, 0.15, 0.083], [0.839, side * 0.624, 0.454, 0.12, 0.061],
      ], carbonMat);
    }

    body("Tapered engine cover", [
      [-2.14, 0, 0.28, 0.14, 0.115], [-1.70, 0, 0.34, 0.237, 0.17],
      [-1.23, 0, 0.44, 0.31, 0.255], [-0.77, 0, 0.53, 0.38, 0.34],
      [-0.38, 0, 0.55, 0.39, 0.365], [-0.15, 0, 0.472, 0.32, 0.236],
      [-0.06, 0, 0.43, 0.19, 0.16],
    ]);
    body("Roll hoop air intake", [
      [-0.75, 0, 0.79, 0.06, 0.085], [-0.50, 0, 0.892, 0.135, 0.115],
      [-0.29, 0, 0.94, 0.149, 0.121], [-0.15, 0, 0.953, 0.117, 0.09],
    ]);
    body("Air intake throat", [[-0.16, 0, 0.962, 0.099, 0.067], [-0.133, 0, 0.962, 0.082, 0.054]], carbonMat);
    const fin = addPart("Sculpted engine cover fin", shapePanel([
      [0.16, 0.85], [0.34, 1.02], [0.69, 0.94], [1.62, 0.705], [1.75, 0.565], [0.58, 0.64],
    ], 0.024, 0.01), liveryCyanMat);
    fin.rotation.y = Math.PI / 2;

    wing("Rear wing mainplane", [
      [-0.95, -1.89, 0.60, 0.98], [-0.78, -1.84, 0.68, 1.02], [-0.33, -1.76, 0.68, 1.035],
      [0, -1.75, 0.67, 1.035], [0.33, -1.76, 0.68, 1.035], [0.78, -1.84, 0.68, 1.02], [0.95, -1.89, 0.60, 0.98],
    ], 0.034, 0.095, liveryCyanMat);
    wing("Rear wing upper flap", [
      [-0.925, -2.09, 0.46, 1.17], [-0.61, -2.05, 0.51, 1.21], [0, -2.01, 0.53, 1.225],
      [0.61, -2.05, 0.51, 1.21], [0.925, -2.09, 0.46, 1.17],
    ], 0.023, 0.078, darkAeroMat);
    for (const side of [-1, 1]) {
      const plate = addPart("Rear wing endplate", shapePanel([
        [-0.32, 0.79], [-0.29, 1.06], [-0.16, 1.21], [0.29, 1.28], [0.39, 1.19],
        [0.38, 0.86], [0.22, 0.74], [-0.08, 0.75],
      ], 0.04, 0.025), darkAeroMat);
      plate.rotation.y = Math.PI / 2;
      plate.position.set(side * 0.94, 0, -2.17);
      body("Rear wing support", [[-2.22, side * 0.23, 0.64, 0.038, 0.34], [-1.97, side * 0.23, 0.65, 0.036, 0.33]], darkAeroMat);
    }

    // 8. Functioning FIA Rain / Brake LED Light
    const lightGeom = new THREE.BoxGeometry(0.38, 0.18, 0.06);
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xff1744,
      emissive: 0x550011,
      emissiveIntensity: 1.0,
      roughness: 0.2,
    });
    this.brakeLightMesh = new THREE.Mesh(lightGeom, lightMat);
    this.brakeLightMesh.position.set(0, 0.42, -2.18);
    chassisGroup.add(this.brakeLightMesh);

    // 9. Suspension Double-Wishbones
    const createWishbones = (x, y, z) => {
      const armGeom = new THREE.CylinderGeometry(0.02, 0.02, Math.abs(x) * 0.72, 8);
      armGeom.rotateZ(Math.PI / 2);

      const upperArm = new THREE.Mesh(armGeom, carbonMat);
      upperArm.position.set(x * 0.55, y + 0.12, z);
      chassisGroup.add(upperArm);

      const lowerArm = new THREE.Mesh(armGeom, carbonMat);
      lowerArm.position.set(x * 0.55, y - 0.08, z);
      chassisGroup.add(lowerArm);
    };

    createWishbones(-1.18, 0.38, 1.45);
    createWishbones(1.18, 0.38, 1.45);
    createWishbones(-1.22, 0.38, -1.45);
    createWishbones(1.22, 0.38, -1.45);

    // 10. Open-Wheel Assemblies with Visible Spinning
    const tireRadius = 0.38;
    const rimRadius = tireRadius * 0.62;
    const tireSidewallTex = createWheelSidewallTexture("#ffd200");

    const createWheel = (x, y, z, isFront) => {
      const tireWidth = isFront ? 0.34 : 0.46;
      const hubGroup = new THREE.Group();
      hubGroup.position.set(x, y, z);

      // Static Brake Disc & Caliper
      const discGeom = new THREE.CylinderGeometry(rimRadius * 0.88, rimRadius * 0.88, 0.04, 16);
      discGeom.rotateZ(Math.PI / 2);
      const disc = new THREE.Mesh(discGeom, brakeRotorMat);
      hubGroup.add(disc);

      const caliperGeom = new THREE.BoxGeometry(0.06, 0.14, 0.16);
      const caliper = new THREE.Mesh(caliperGeom, brakeCaliperMat);
      caliper.position.set(x > 0 ? -0.04 : 0.04, 0.15, 0.08);
      hubGroup.add(caliper);

      // Wheel Roll Group (Rotates along X axis)
      const rollGroup = new THREE.Group();
      hubGroup.add(rollGroup);

      const tireGeom = shapeSlick(tireRadius, tireWidth, rimRadius * 0.97);
      const tireTreadMat = new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 0.87, metalness: 0.04 });
      const tire = new THREE.Mesh(tireGeom, tireTreadMat);
      tire.castShadow = true;
      rollGroup.add(tire);

      // Pirelli Sidewall Face Disc
      const sidewallGeom = new THREE.CircleGeometry(tireRadius * 0.89, 32);
      const sidewallMat = new THREE.MeshBasicMaterial({
        map: tireSidewallTex,
        transparent: true,
        side: THREE.DoubleSide,
      });

      const outerSidewall = new THREE.Mesh(sidewallGeom, sidewallMat);
      outerSidewall.position.x = x > 0 ? tireWidth / 2 + 0.005 : -tireWidth / 2 - 0.005;
      outerSidewall.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      rollGroup.add(outerSidewall);

      // Lightweight 5-Spoke Rim Barrel
      const rimBarrelGeom = new THREE.CylinderGeometry(rimRadius, rimRadius, tireWidth * 0.92, 20);
      rimBarrelGeom.rotateZ(Math.PI / 2);
      const rimBarrel = new THREE.Mesh(rimBarrelGeom, rimAlloyMat);
      rollGroup.add(rimBarrel);

      const spokeCount = 5;
      const spokeGroup = new THREE.Group();
      spokeGroup.position.x = x > 0 ? tireWidth * 0.42 : -tireWidth * 0.42;

      for (let s = 0; s < spokeCount; s++) {
        const spokeAngle = (s / spokeCount) * Math.PI * 2;
        const spokeGeom = new THREE.BoxGeometry(0.04, rimRadius * 0.82, 0.05);
        const spoke = new THREE.Mesh(spokeGeom, rimAlloyMat);
        spoke.position.set(0, (rimRadius * 0.42) * Math.cos(spokeAngle), (rimRadius * 0.42) * Math.sin(spokeAngle));
        spoke.rotation.x = spokeAngle;
        spokeGroup.add(spoke);
      }

      const nutGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 6);
      nutGeom.rotateZ(Math.PI / 2);
      const nutMat = new THREE.MeshStandardMaterial({
        color: x > 0 ? 0xff2233 : 0x0078d4,
        metalness: 0.95,
        roughness: 0.1,
      });
      const nut = new THREE.Mesh(nutGeom, nutMat);
      spokeGroup.add(nut);

      rollGroup.add(spokeGroup);

      if (isFront) {
        const steerGroup = new THREE.Group();
        steerGroup.position.set(x, y, z);
        hubGroup.position.set(0, 0, 0);
        steerGroup.add(hubGroup);
        this.carGroup.add(steerGroup);
        this.frontWheelSteerGroups.push(steerGroup);
        this.wheelRollGroups.push(rollGroup);
      } else {
        this.carGroup.add(hubGroup);
        this.wheelRollGroups.push(rollGroup);
      }
    };

    createWheel(-1.18, 0.38, 1.45, true);  // Front Left
    createWheel(1.18, 0.38, 1.45, true);   // Front Right
    createWheel(-1.22, 0.38, -1.45, false); // Rear Left
    createWheel(1.22, 0.38, -1.45, false);  // Rear Right
  }

  updateDashboard(speedMph, speedKmh, rpm, gear, throttle, brake, delta, lap, maxLaps, latG) {
    const ctx = this.dashCtx;
    if (!ctx) return;

    speedMph = Math.max(0, Math.round(speedMph || 0));
    speedKmh = Math.max(0, Math.round(speedKmh || (speedMph * 1.60934)));
    rpm = Math.max(4500, Math.min(13500, rpm || 4500));
    const gearStr = gear !== undefined && gear !== null ? `${gear}` : (speedMph < 1 ? "1" : "1");
    throttle = Math.max(0, Math.min(1.0, throttle || 0));
    brake = Math.max(0, Math.min(1.0, brake || 0));
    delta = typeof delta === "number" ? delta : 0;
    lap = lap || 1;
    maxLaps = maxLaps || 5;
    latG = Math.abs(latG || 0);

    // Throttle GPU canvas texture upload to 30 FPS to prevent render stalls
    const now = performance.now();
    if (this._lastDashUpdate && now - this._lastDashUpdate < 30) return;
    this._lastDashUpdate = now;

    // 1. Dark High-Contrast Carbon LCD Display Background (1024x512)
    ctx.fillStyle = "#04070d";
    ctx.fillRect(0, 0, 1024, 512);

    // Subtle Carbon Weave Pattern Grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < 1024; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 0; y < 512; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    // High-Tech Outer Display Border
    ctx.strokeStyle = "#00f2fe";
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 1012, 500);

    // Corner Accents
    ctx.fillStyle = "#00f2fe";
    ctx.fillRect(6, 6, 24, 8);
    ctx.fillRect(6, 6, 8, 24);
    ctx.fillRect(994, 6, 24, 8);
    ctx.fillRect(1010, 6, 8, 24);
    ctx.fillRect(6, 498, 24, 8);
    ctx.fillRect(6, 482, 8, 24);
    ctx.fillRect(994, 498, 24, 8);
    ctx.fillRect(1010, 482, 8, 24);

    // 2. Top Shift Lights: 18 High-Intensity FIA LEDs
    const totalLeds = 18;
    const rpmMin = 5000;
    const rpmMax = 13200;
    const rpmFraction = Math.max(0, Math.min(1.0, (rpm - rpmMin) / (rpmMax - rpmMin)));
    const activeLeds = Math.floor(rpmFraction * totalLeds);
    const isRedlineFlashing = rpm >= 12800 && (Math.floor(now / 80) % 2 === 0);

    const ledW = 40;
    const ledH = 24;
    const ledGap = 9;
    const startX = (1024 - (totalLeds * ledW + (totalLeds - 1) * ledGap)) / 2;

    for (let i = 0; i < totalLeds; i++) {
      const lx = startX + i * (ledW + ledGap);
      const ly = 22;
      const isActive = i < activeLeds || isRedlineFlashing;

      let color = "#101826"; // Inactive LED slot
      let glow = null;

      if (isActive) {
        if (i < 6) {
          color = "#00e676"; // Green
          glow = "rgba(0, 230, 118, 0.9)";
        } else if (i < 12) {
          color = "#ff1744"; // Red
          glow = "rgba(255, 23, 68, 0.9)";
        } else {
          color = "#00f0ff"; // Electric Blue / Purple
          glow = "rgba(0, 240, 255, 0.95)";
        }
      }

      ctx.fillStyle = color;
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 14;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.roundRect(lx, ly, ledW, ledH, 6);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // 3. Top Status Row
    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 15px 'Segoe UI', monospace";
    ctx.textAlign = "left";
    ctx.fillText("F1 TELEMETRY // GENESIS-26", 40, 72);

    ctx.textAlign = "center";
    ctx.fillStyle = "#00e676";
    ctx.fillText("ERS: HOTLAP [100%]", 512, 72);

    ctx.textAlign = "right";
    const drsActive = speedMph > 165;
    ctx.fillStyle = drsActive ? "#00f0ff" : "#8394ac";
    ctx.fillText(drsActive ? "DRS: OPEN" : "DRS: AVAIL", 984, 72);

    // Divider Line
    ctx.strokeStyle = "#1b283d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, 84);
    ctx.lineTo(994, 84);
    ctx.stroke();

    // 4. Central Large Gear Box (Main Center Cluster)
    const gearBoxX = 392;
    const gearBoxY = 96;
    const gearBoxW = 240;
    const gearBoxH = 260;

    ctx.fillStyle = "#0a111e";
    ctx.beginPath();
    ctx.roundRect(gearBoxX, gearBoxY, gearBoxW, gearBoxH, 12);
    ctx.fill();

    ctx.strokeStyle = "#0078d4";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(gearBoxX, gearBoxY, gearBoxW, gearBoxH, 12);
    ctx.stroke();

    ctx.fillStyle = "#60cdff";
    ctx.font = "bold 20px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("GEAR", 512, gearBoxY + 36);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 160px 'Segoe UI', monospace";
    ctx.textBaseline = "middle";
    ctx.fillText(gearStr, 512, gearBoxY + 145);
    ctx.textBaseline = "alphabetic";

    // 5. Left Sector: Speedometer & Unit Gauges
    const leftBoxX = 32;
    const leftBoxY = 96;
    const leftBoxW = 340;
    const leftBoxH = 260;

    ctx.fillStyle = "#0a111e";
    ctx.beginPath();
    ctx.roundRect(leftBoxX, leftBoxY, leftBoxW, leftBoxH, 12);
    ctx.fill();
    ctx.strokeStyle = "#1b283d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(leftBoxX, leftBoxY, leftBoxW, leftBoxH, 12);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 18px 'Segoe UI', sans-serif";
    ctx.fillText("VEHICLE SPEED", leftBoxX + 24, leftBoxY + 38);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 92px 'Segoe UI', sans-serif";
    ctx.fillText(`${speedMph}`, leftBoxX + 24, leftBoxY + 135);

    ctx.fillStyle = "#00f0ff";
    ctx.font = "bold 28px 'Segoe UI', sans-serif";
    ctx.fillText("MPH", leftBoxX + 215, leftBoxY + 115);

    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 26px monospace";
    ctx.fillText(`${speedKmh} KM/H`, leftBoxX + 24, leftBoxY + 185);

    // Speed bar (up to 240 mph)
    const speedRatio = Math.min(1.0, speedMph / 235);
    ctx.fillStyle = "#162030";
    ctx.fillRect(leftBoxX + 24, leftBoxY + 210, 292, 16);
    ctx.fillStyle = "#0078d4";
    ctx.fillRect(leftBoxX + 24, leftBoxY + 210, 292 * speedRatio, 16);

    // 6. Right Sector: Engine RPM & Tachometer Bar
    const rightBoxX = 652;
    const rightBoxY = 96;
    const rightBoxW = 340;
    const rightBoxH = 260;

    ctx.fillStyle = "#0a111e";
    ctx.beginPath();
    ctx.roundRect(rightBoxX, rightBoxY, rightBoxW, rightBoxH, 12);
    ctx.fill();
    ctx.strokeStyle = "#1b283d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rightBoxX, rightBoxY, rightBoxW, rightBoxH, 12);
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 18px 'Segoe UI', sans-serif";
    ctx.fillText("ENGINE RPM", rightBoxX + rightBoxW - 24, rightBoxY + 38);

    ctx.fillStyle = "#60cdff";
    ctx.font = "900 68px monospace";
    ctx.fillText(`${Math.round(rpm).toLocaleString()}`, rightBoxX + rightBoxW - 24, rightBoxY + 130);

    // Segmented RPM Bar
    const barX = rightBoxX + 24;
    const barY = rightBoxY + 200;
    const barW = 292;
    const barH = 24;

    ctx.fillStyle = "#162030";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 4);
    ctx.fill();

    const rpmBarW = Math.max(0, Math.min(barW, barW * rpmFraction));
    const rpmGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    rpmGrad.addColorStop(0, "#0078d4");
    rpmGrad.addColorStop(0.65, "#00e676");
    rpmGrad.addColorStop(0.85, "#ffb900");
    rpmGrad.addColorStop(1.0, "#ff1744");

    ctx.fillStyle = rpmGrad;
    ctx.beginPath();
    ctx.roundRect(barX, barY, rpmBarW, barH, 4);
    ctx.fill();

    // 7. Bottom Telemetry Tray (Lap, Delta, Lateral G, Pedals)
    const botY = 372;
    const botH = 120;
    ctx.fillStyle = "#080d16";
    ctx.beginPath();
    ctx.roundRect(32, botY, 960, botH, 12);
    ctx.fill();
    ctx.strokeStyle = "#1b283d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(32, botY, 960, botH, 12);
    ctx.stroke();

    // Sub-col 1: Lap Counter
    ctx.textAlign = "left";
    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.fillText("CIRCUIT LAP", 56, botY + 36);
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 44px 'Segoe UI', monospace";
    ctx.fillText(`${lap} / ${maxLaps}`, 56, botY + 88);

    // Sub-col 2: Live Delta vs Best
    ctx.textAlign = "center";
    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.fillText("DELTA VS BEST", 320, botY + 36);

    const deltaSign = delta <= 0 ? "-" : "+";
    ctx.fillStyle = delta <= 0 ? "#00e676" : "#ff3344";
    ctx.font = "900 44px monospace";
    ctx.fillText(`${deltaSign}${Math.abs(delta).toFixed(2)}s`, 320, botY + 88);

    // Sub-col 3: Lateral G Force
    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.fillText("CORNERING LOAD", 580, botY + 36);
    ctx.fillStyle = "#00f0ff";
    ctx.font = "900 44px monospace";
    ctx.fillText(`${latG.toFixed(2)} G`, 580, botY + 88);

    // Sub-col 4: Throttle & Brake Vertical Bars
    const pedX = 760;
    ctx.textAlign = "left";
    ctx.fillStyle = "#8394ac";
    ctx.font = "bold 14px 'Segoe UI', sans-serif";
    ctx.fillText("THR", pedX, botY + 30);
    ctx.fillText("BRK", pedX + 90, botY + 30);

    // Throttle Bar (Green)
    ctx.fillStyle = "#12241b";
    ctx.fillRect(pedX, botY + 42, 60, 56);
    ctx.fillStyle = "#00e676";
    const thrHeight = Math.round(throttle * 56);
    ctx.fillRect(pedX, botY + 42 + (56 - thrHeight), 60, thrHeight);

    // Brake Bar (Red)
    ctx.fillStyle = "#261317";
    ctx.fillRect(pedX + 90, botY + 42, 60, 56);
    ctx.fillStyle = "#ff1744";
    const brkHeight = Math.round(brake * 56);
    ctx.fillRect(pedX + 90, botY + 42 + (56 - brkHeight), 60, brkHeight);

    // Final Canvas Texture Upload Trigger
    this.dashTexture.needsUpdate = true;
  }

  updateVisuals(speed, steerAngle, isBraking, dt) {
    const spinRate = (speed / 0.38) * dt;
    this.wheelRollGroups.forEach((w) => {
      w.rotation.x += spinRate;
    });

    const steerSmooth = 1.0 - Math.exp(-22.0 * dt);
    this.frontWheelSteerGroups.forEach((g) => {
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, -steerAngle, steerSmooth);
    });

    if (this.steeringWheelMesh) {
      this.steeringWheelMesh.rotation.z = THREE.MathUtils.lerp(this.steeringWheelMesh.rotation.z, steerAngle * 2.5, steerSmooth);
    }

    if (this.brakeLightMesh) {
      if (isBraking) {
        this.brakeLightMesh.material.color.setHex(0xff0022);
        this.brakeLightMesh.material.emissive.setHex(0xff0022);
        this.brakeLightMesh.material.emissiveIntensity = 2.4;
      } else {
        const pulse = (Math.sin(performance.now() * 0.012) + 1) * 0.5;
        this.brakeLightMesh.material.color.setHex(0xaa1122);
        this.brakeLightMesh.material.emissive.setHex(0x550011);
        this.brakeLightMesh.material.emissiveIntensity = 0.4 + pulse * 0.6;
      }
    }

    if (this.chassisMesh) {
      // High-downforce F1 suspension dynamics:
      // Nose dives under threshold braking, slight squat under full throttle
      const pitch = isBraking ? 0.014 : -Math.min(0.007, speed * 0.00008);
      // Realistic chassis roll outward against lateral acceleration (subtle 0.8° max, stable)
      const roll = steerAngle * 0.016;
      const smoothFactor = 1.0 - Math.exp(-12.0 * dt);
      this.chassisMesh.rotation.x = THREE.MathUtils.lerp(this.chassisMesh.rotation.x, pitch, smoothFactor);
      this.chassisMesh.rotation.z = THREE.MathUtils.lerp(this.chassisMesh.rotation.z, roll, smoothFactor);
    }

    // Beta: Brake Disc Thermal Incandescence (Molten Rotor Glow)
    if (this.brakeRotorMat) {
      if (isBraking) {
        this.brakeHeat = Math.min(1.0, (this.brakeHeat || 0) + dt * 1.8);
      } else {
        const cooling = 0.25 + (Math.abs(speed) / 65.0) * 0.95;
        this.brakeHeat = Math.max(0.0, (this.brakeHeat || 0) - dt * cooling);
      }
      if (this.brakeHeat > 0.04) {
        this.brakeRotorMat.emissive.setHex(0xff3300);
        this.brakeRotorMat.emissiveIntensity = Math.pow(this.brakeHeat, 1.25) * 2.8;
      } else {
        this.brakeRotorMat.emissive.setHex(0x000000);
        this.brakeRotorMat.emissiveIntensity = 0.0;
      }
    }
  }
}

/* ==========================================================================
   3D Camera Manager (Chase, Cockpit POV behind 3D Dash, TV, Orbit)
   ========================================================================== */

class CameraManager3D {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.mode = "chase";

    this.currentPos = new THREE.Vector3(0, 10, -20);
    this.currentLookAt = new THREE.Vector3(0, 0, 0);

    this.desiredPos = new THREE.Vector3();
    this.desiredLookAt = new THREE.Vector3();
    this.hoodPos = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();

    this.orbitDistance = 145;
    this.orbitTarget = new THREE.Vector3();
    this.orbitFocus = new THREE.Vector3();
    this.orbitDirection = new THREE.Vector3();
    this.orbitRadius = 100;
    this.orbitFitDistance = 145;
    this.resetTrackAngles();
    this.resetAerialView();
    this.isDragging = false;
    this.prevMouse = { x: 0, y: 0 };
    this.locked = false;
    this.editingTrack = false;
    this.pinchSpan = 0;

    this.cameraYaw = 0; // Filtered camera yaw for rock-solid stability in turns
    this.cameraInitialized = false;

    // Enhanced Wide Chase Camera (pushed far behind for panoramic view of track & crowds)
    this.chaseDistance = 34.0;
    this.chaseHeight = 9.6;

    this.bindEvents();
  }

  setTrack(track) {
    this.orbitSamples = track.samples;
    this.orbitMargin = track.roadWidth / 2 + 16;
    this.gantryPosition = track.gantryPosition;
    this.fitTrack(1, true);
  }

  circuitBounds(theta) {
    const sin = Math.sin(theta), cos = Math.cos(theta);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const { position } of this.orbitSamples) {
      const x = position.x * cos - position.z * sin;
      const z = position.x * sin + position.z * cos;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { minX, maxX, minZ, maxZ };
  }

  fitTrack(zoom = 1, orient = false) {
    // Reserve the drawer/header space so the fitted track remains visible.
    const panelWidth = id => {
      const el = $(id);
      return el && !el.classList.contains("collapsed") ? (el.getBoundingClientRect?.().width || 320) + 40 : 24;
    };
    const widthFraction = Math.max(0.2, 1 - 2 * Math.max(panelWidth("leftPanel"), panelWidth("rightPanel")) / window.innerWidth);
    const heightFraction = Math.max(0.3, 1 - 176 / window.innerHeight);
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(50 / 2));
    const horizontal = tanHalfFov * this.camera.aspect * widthFraction;
    const vertical = tanHalfFov * heightFraction;
    let bounds = this.circuitBounds(this.orbitTheta);
    if (orient && this.mode === "orbit" && this.orbitPhi > 1.56) {
      const framingSize = ({ minX, maxX, minZ, maxZ }) => Math.max(
        (maxX - minX + 2 * this.orbitMargin) / horizontal,
        (maxZ - minZ + 2 * this.orbitMargin) / vertical,
      );
      this.orbitTheta = 0;
      bounds = this.circuitBounds(0);
      let bestSize = framingSize(bounds);
      for (let step = -29; step <= 30; step++) {
        const theta = step * Math.PI / 60;
        const candidate = this.circuitBounds(theta);
        const size = framingSize(candidate);
        if (size < bestSize) {
          this.orbitTheta = theta;
          bounds = candidate;
          bestSize = size;
        }
      }
    }
    const sinTheta = Math.sin(this.orbitTheta), cosTheta = Math.cos(this.orbitTheta);
    const sinPhi = Math.sin(this.orbitPhi), cosPhi = Math.cos(this.orbitPhi);
    this.orbitDirection.set(sinTheta * cosPhi, sinPhi, cosTheta * cosPhi);
    const { minX, maxX, minZ, maxZ } = bounds;
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const halfWidth = (maxX - minX) * 0.5 + this.orbitMargin;
    const halfDepth = (maxZ - minZ) * 0.5 + this.orbitMargin;
    this.orbitTarget.set(centerX * cosTheta + centerZ * sinTheta, 0, -centerX * sinTheta + centerZ * cosTheta);
    this.orbitRadius = Math.hypot(halfWidth, halfDepth);

    // Test the corners of the footprint in the camera's rotated basis.
    let distance = 0;
    for (const y of [0, 10]) {
      for (const z of [-halfDepth, halfDepth]) {
        const depth = y * sinPhi + z * cosPhi;
        const up = y * cosPhi - z * sinPhi;
        distance = Math.max(distance, depth + Math.max(halfWidth / horizontal, Math.abs(up) / vertical));
      }
    }
    this.orbitFitDistance = distance * 1.025;
    this.orbitDistance = THREE.MathUtils.clamp(this.orbitFitDistance * zoom, this.orbitMinDistance, this.orbitFitDistance * 4);
    this.fittedTheta = this.orbitTheta;
    this.fittedPhi = this.orbitPhi;
    this.updateZoomButtons();
  }

  setMode(mode) {
    this.mode = mode;
    this.cameraInitialized = false;
    this.pinchSpan = 0;
    this.domElement.classList.toggle("circuit-camera", mode === "orbit");
    $("circuitZoomControls").hidden = mode !== "orbit";
    if (this.isTrackOrbit) this.resetOrbitView();
  }

  resetOrbitView() {
    this.resetTrackAngles();
    this.fitTrack(1, true);
  }

  resetTrackAngles() {
    this.orbitTheta = 0;
    this.orbitPhi = Math.PI / 2 - 0.00001;
  }

  get isTrackOrbit() {
    return this.mode === "orbit" || this.mode === "map";
  }

  get isAerialView() {
    return this.mode === "aerial" || this.isTrackOrbit;
  }

  get orbitMinDistance() {
    return this.mode === "orbit" && !this.editingTrack ? 55 : this.orbitFitDistance * 0.08;
  }

  updateZoomButtons() {
    if (this.mode !== "orbit") return;
    $("btnCircuitZoomIn").disabled = this.orbitDistance <= this.orbitMinDistance;
    $("btnCircuitZoomOut").disabled = this.orbitDistance >= this.orbitFitDistance * 4;
  }

  zoomBy(scale) {
    if (this.locked) return;
    if (this.mode === "aerial") {
      this.aerialDistance = THREE.MathUtils.clamp(this.aerialDistance * scale, 22, 135);
    } else if (this.isTrackOrbit) {
      this.orbitDistance = THREE.MathUtils.clamp(this.orbitDistance * scale, this.orbitMinDistance, this.orbitFitDistance * 4);
      this.updateZoomButtons();
    }
  }

  resetAerialView() {
    this.aerialDistance = 46;
    this.aerialAzimuth = -2.05;
    this.aerialElevation = THREE.MathUtils.degToRad(59);
  }

  bindEvents() {
    this.domElement.addEventListener("mousedown", (e) => {
      if (this.isAerialView && !this.locked && e.button === 0) {
        this.isDragging = true;
        this.prevMouse.x = e.clientX;
        this.prevMouse.y = e.clientY;
      }
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    window.addEventListener("mousemove", (e) => {
      if (this.isAerialView && !this.locked && this.isDragging) {
        const dx = e.clientX - this.prevMouse.x;
        const dy = e.clientY - this.prevMouse.y;
        this.prevMouse.x = e.clientX;
        this.prevMouse.y = e.clientY;

        if (this.mode === "aerial") {
          this.aerialAzimuth -= dx * 0.006;
          this.aerialElevation = THREE.MathUtils.clamp(this.aerialElevation - dy * 0.006, 0.48, 1.55);
        } else {
          this.orbitTheta -= dx * 0.006;
          this.orbitPhi = THREE.MathUtils.clamp(this.orbitPhi - dy * 0.006, 0.1, Math.PI / 2 - 0.00001);
        }
      }
    });

    this.domElement.addEventListener("dblclick", () => {
      if (this.locked) return;
      if (this.mode === "aerial") {
        this.resetAerialView();
        this.cameraInitialized = false;
      } else if (this.isTrackOrbit) {
        this.resetOrbitView();
      }
    });
    this.domElement.addEventListener("wheel", (e) => {
      if (this.isAerialView && !this.locked) {
        e.preventDefault();
        const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
        this.zoomBy(Math.exp(e.deltaY * units * 0.001));
      } else if (this.mode === "chase") {
        this.chaseDistance = Math.max(15, Math.min(60, (this.chaseDistance || 28.0) + e.deltaY * 0.03));
        this.chaseHeight = this.chaseDistance * 0.29;
      }
    }, { passive: false });

    const updatePinch = (e) => {
      if (this.mode !== "orbit" || this.locked || e.targetTouches.length !== 2) {
        this.pinchSpan = 0;
        return;
      }
      const a = e.targetTouches[0], b = e.targetTouches[1];
      const span = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (e.type === "touchmove" && this.pinchSpan > 0 && span > 0) {
        e.preventDefault();
        this.zoomBy(this.pinchSpan / span);
      }
      this.pinchSpan = span;
    };
    this.domElement.addEventListener("touchstart", updatePinch);
    this.domElement.addEventListener("touchmove", updatePinch, { passive: false });
    this.domElement.addEventListener("touchend", updatePinch);
    this.domElement.addEventListener("touchcancel", () => { this.pinchSpan = 0; });

    $("btnCircuitZoomIn").addEventListener("click", () => this.zoomBy(0.72));
    $("btnCircuitZoomOut").addEventListener("click", () => this.zoomBy(1 / 0.72));
    $("btnCircuitFit").addEventListener("click", () => {
      if (!this.locked && this.mode === "orbit") this.resetOrbitView();
    });
  }

  update(carGroup, forwardDir, speed, dt, editingTrack = false, carPos = carGroup.position) {
    if (this.editingTrack !== editingTrack) {
      this.editingTrack = editingTrack;
      this.updateZoomButtons();
    }

    if (this.mode === "chase") {
      const chaseOffsetDist = this.chaseDistance;
      const gateDistance = Math.hypot(carPos.x - this.gantryPosition.x, carPos.z - this.gantryPosition.z);
      const gateClearance = THREE.MathUtils.smoothstep(gateDistance, chaseOffsetDist + 16, chaseOffsetDist + 48);
      // Go under the start light housing while the camera crosses the bridge.
      const chaseHeight = THREE.MathUtils.lerp(4.1, this.chaseHeight, gateClearance);

      const carYaw = Math.atan2(forwardDir.x, forwardDir.z);
      if (!this.cameraInitialized) {
        this.cameraYaw = carYaw;
        this.currentPos.set(
          carPos.x - Math.sin(this.cameraYaw) * chaseOffsetDist,
          carPos.y + chaseHeight,
          carPos.z - Math.cos(this.cameraYaw) * chaseOffsetDist
        );
        this.currentLookAt.copy(carPos).addScaledVector(forwardDir, 8.0);
        this.currentLookAt.y += 1.8;
        this.cameraInitialized = true;
      }

      // Smooth camera yaw trailing behind car (gentle, cinematic, rock-solid stable in turns)
      let dYaw = carYaw - this.cameraYaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const yawSmooth = 1.0 - Math.exp(-5.5 * dt);
      this.cameraYaw += dYaw * THREE.MathUtils.clamp(yawSmooth, 0, 1);

      this.desiredPos.set(
        carPos.x - Math.sin(this.cameraYaw) * chaseOffsetDist,
        carPos.y + chaseHeight,
        carPos.z - Math.cos(this.cameraYaw) * chaseOffsetDist
      );

      const posSmooth = 1.0 - Math.exp(-9.0 * dt);
      this.currentPos.lerp(this.desiredPos, posSmooth);

      // Look 8m ahead of car so the vehicle sits in the lower third with sweeping sightlines
      this.desiredLookAt.copy(carPos).addScaledVector(forwardDir, 8.0);
      this.desiredLookAt.y += 1.8;
      const lookSmooth = 1.0 - Math.exp(-12.0 * dt);
      this.currentLookAt.lerp(this.desiredLookAt, lookSmooth);

      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);

      const targetFOV = 52 + Math.abs(speed * MS_TO_MPH) * 0.05;
      const newFOV = THREE.MathUtils.lerp(this.camera.fov, Math.min(68, targetFOV), 1 - Math.exp(-5 * dt));
      if (newFOV !== this.camera.fov) {
        this.camera.fov = newFOV;
        this.camera.updateProjectionMatrix();
      }

    } else if (this.mode === "hood") {
      // Cockpit POV: driver eye positioned inside the cockpit, looking directly past the
      // animated steering wheel with its integrated digital dashboard, and down the race track ahead.
      carGroup.updateMatrixWorld(true);
      const localEye = new THREE.Vector3(0, 0.74, 0.12);
      const localLook = new THREE.Vector3(0, 0.36, 18.0);

      this.hoodPos.copy(localEye).applyMatrix4(carGroup.matrixWorld);
      this.lookPos.copy(localLook).applyMatrix4(carGroup.matrixWorld);

      this.camera.position.copy(this.hoodPos);
      this.camera.lookAt(this.lookPos);
      if (this.camera.fov !== 72) {
        this.camera.fov = 72;
        this.camera.updateProjectionMatrix();
      }

    } else if (this.mode === "aerial") {
      // Let the helicopter coast through changes in direction while its gimbal
      // stays aimed at the car and the piece of road immediately ahead.
      const heading = Math.atan2(forwardDir.x, forwardDir.z);
      if (!this.cameraInitialized) this.cameraYaw = heading;
      const turn = heading - this.cameraYaw;
      this.cameraYaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-2.6 * dt));

      const azimuth = this.cameraYaw + this.aerialAzimuth;
      const distance = this.aerialDistance * (1 + Math.min(Math.abs(speed) / 350, 0.2));
      const groundDistance = Math.cos(this.aerialElevation) * distance;
      const travelLead = speed * 0.13;
      this.desiredPos.set(
        carPos.x + Math.sin(azimuth) * groundDistance + forwardDir.x * travelLead,
        carPos.y + Math.sin(this.aerialElevation) * distance,
        carPos.z + Math.cos(azimuth) * groundDistance + forwardDir.z * travelLead,
      );
      if (this.cameraInitialized) {
        this.currentPos.lerp(this.desiredPos, 1 - Math.exp(-7.5 * dt));
      } else {
        this.currentPos.copy(this.desiredPos);
        this.cameraInitialized = true;
      }
      const framingLead = Math.min(distance * 0.14, 4 + Math.abs(speed) * 0.04) * Math.sign(speed || 1);
      this.desiredLookAt.copy(carPos).addScaledVector(forwardDir, framingLead);
      this.desiredLookAt.y += 0.4;
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.desiredLookAt);
      if (this.camera.fov !== 36) {
        this.camera.fov = 36;
        this.camera.updateProjectionMatrix();
      }

    } else if (this.isTrackOrbit) {
      if (this.fittedTheta !== this.orbitTheta || this.fittedPhi !== this.orbitPhi) {
        this.fitTrack(this.orbitDistance / this.orbitFitDistance);
      }
      const zoom = this.orbitDistance / this.orbitFitDistance;
      const follow = this.mode === "orbit" && !editingTrack
        ? THREE.MathUtils.smoothstep(1 - zoom, 0.10, 0.66)
        : 0;
      this.desiredLookAt.copy(this.orbitTarget).lerp(carPos, follow);
      this.desiredLookAt.addScaledVector(forwardDir, follow * speed * 0.12);
      if (follow > 0 && this.cameraInitialized) {
        this.orbitFocus.lerp(this.desiredLookAt, 1 - Math.exp(-8 * dt));
      } else {
        this.orbitFocus.copy(this.desiredLookAt);
      }
      this.cameraInitialized = true;
      this.camera.position.copy(this.orbitFocus).addScaledVector(this.orbitDirection, this.orbitDistance);
      this.camera.lookAt(this.orbitFocus);
      this.camera.far = Math.max(35000, this.orbitDistance + this.orbitRadius * 3);
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
  }
}

/* ==========================================================================
   F1 8-Speed Seamless Shift Transmission & RPM Model
   ========================================================================== */

function computeF1Transmission(speedMph) {
  const gearRatios = [
    { gear: 1, min: 0, max: 58 },
    { gear: 2, min: 52, max: 88 },
    { gear: 3, min: 82, max: 118 },
    { gear: 4, min: 112, max: 146 },
    { gear: 5, min: 142, max: 172 },
    { gear: 6, min: 168, max: 195 },
    { gear: 7, min: 190, max: 212 },
    { gear: 8, min: 208, max: 235 },
  ];

  let currentGear = 1;
  for (const g of gearRatios) {
    if (speedMph >= g.min) {
      currentGear = g.gear;
    }
  }

  const gInfo = gearRatios[currentGear - 1];
  const gearFraction = Math.max(0, Math.min(1.0, (speedMph - gInfo.min) / Math.max(1, gInfo.max - gInfo.min)));

  const idleRPM = 4500;
  const maxRPM = 13200;
  const targetRPM = idleRPM + gearFraction * (maxRPM - idleRPM);

  return {
    gear: speedMph < 1 ? 1 : currentGear,
    gearDisplay: speedMph < 1 ? "1" : `${currentGear}`,
    rpm: targetRPM,
    gearFraction: gearFraction,
  };
}

/* ==========================================================================
   Realistic Web Audio Racing Engine Sound with 8-Speed Gearbox Simulation
   ========================================================================== */

class RacingEngineSound {
  constructor() {
    this.ctx = null;
    this.enabled = false;

    this.masterGain = null;
    this.filterNode = null;
    this.distortionNode = null;

    this.osc1 = null;
    this.osc2 = null;
    this.osc3 = null;
    this.turboOsc = null;
    this.turboGain = null;

    this.rpm = 4500;
    this.gear = 1;
    this.isBraking = false;
    this.rumbleOsc = null;
    this.rumbleGain = null;
  }

  createDistortionCurve(amount = 22) {
    const k = amount;
    const n = 512;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  toggle() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.distortionNode = this.ctx.createWaveShaper();
      this.distortionNode.curve = this.createDistortionCurve(18);
      this.distortionNode.oversample = "4x";

      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = "bandpass";
      this.filterNode.frequency.setValueAtTime(800, this.ctx.currentTime);
      this.filterNode.Q.setValueAtTime(1.8, this.ctx.currentTime);

      this.filterNode.connect(this.distortionNode);
      this.distortionNode.connect(this.masterGain);

      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = "triangle";
      this.osc1.frequency.setValueAtTime(140, this.ctx.currentTime);

      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = "sawtooth";
      this.osc2.frequency.setValueAtTime(280, this.ctx.currentTime);

      this.osc3 = this.ctx.createOscillator();
      this.osc3.type = "sine";
      this.osc3.frequency.setValueAtTime(420, this.ctx.currentTime);

      const oscGain1 = this.ctx.createGain();
      oscGain1.gain.value = 0.65;
      const oscGain2 = this.ctx.createGain();
      oscGain2.gain.value = 0.35;
      const oscGain3 = this.ctx.createGain();
      oscGain3.gain.value = 0.20;

      this.osc1.connect(oscGain1).connect(this.filterNode);
      this.osc2.connect(oscGain2).connect(this.filterNode);
      this.osc3.connect(oscGain3).connect(this.filterNode);

      this.turboOsc = this.ctx.createOscillator();
      this.turboOsc.type = "sine";
      this.turboOsc.frequency.setValueAtTime(2800, this.ctx.currentTime);

      this.turboGain = this.ctx.createGain();
      this.turboGain.gain.setValueAtTime(0.015, this.ctx.currentTime);

      this.turboOsc.connect(this.turboGain);
      this.turboGain.connect(this.masterGain);

      this.osc1.start();
      this.osc2.start();
      this.osc3.start();
      this.turboOsc.start();

      this.rumbleOsc = this.ctx.createOscillator();
      this.rumbleOsc.type = "sawtooth";
      this.rumbleOsc.frequency.setValueAtTime(48, this.ctx.currentTime);
      this.rumbleGain = this.ctx.createGain();
      this.rumbleGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.rumbleOsc.connect(this.rumbleGain).connect(this.masterGain);
      this.rumbleOsc.start();

      this.enabled = true;
    } else {
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      this.enabled = !this.enabled;
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.08 : 0.0, this.ctx.currentTime, 0.05);
    }
    return this.enabled;
  }

  update(speedMph, isBraking = false, throttle = 0.8, rpm = 4500, gear = 1, isCurb = false) {
    this.rpm = rpm;
    this.gear = gear;
    this.isBraking = isBraking;

    if (!this.ctx || !this.enabled) return;

    const maxRPM = 13200;
    const baseFreq = Math.max(85, this.rpm * 0.048);
    const now = this.ctx.currentTime;

    this.osc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.osc2.frequency.setTargetAtTime(baseFreq * 2.0, now, 0.03);
    this.osc3.frequency.setTargetAtTime(baseFreq * 3.0, now, 0.03);

    const filterFreq = 650 + (this.rpm / maxRPM) * 2200;
    this.filterNode.frequency.setTargetAtTime(filterFreq, now, 0.04);

    const turboFreq = 2600 + (this.rpm / maxRPM) * 3200;
    this.turboOsc.frequency.setTargetAtTime(turboFreq, now, 0.05);
    this.turboGain.gain.setTargetAtTime(isBraking ? 0.005 : 0.02 + throttle * 0.015, now, 0.05);

    if (this.rumbleGain && this.rumbleOsc) {
      if (isCurb && speedMph > 15) {
        this.rumbleGain.gain.setTargetAtTime(0.14, now, 0.03);
        this.rumbleOsc.frequency.setTargetAtTime(40 + (speedMph * 0.35), now, 0.03);
      } else {
        this.rumbleGain.gain.setTargetAtTime(0.0, now, 0.05);
      }
    }
  }
}

/* ==========================================================================
   Heuristic NPC AI Driver Optimizer
   ========================================================================== */

class HeuristicNPCDriver {
  constructor() {
    this.reset();
  }

  reset() {
    this.lapNumber = 1;
    this.bestLapTime = Infinity;
    this.bestLapNumber = null;
    this.bestParams = null;
    this.bestPathOffsets = null;
    this.currentPathOffsets = null;
    this.history = [];
    this.explorationTemp = 0.35;

    this.currentParams = {
      name: "Attempt #1 - Baseline Recon",
      pathStyle: "Geometric Mid-Apex Arc",
      phaseBadge: "Reconnaissance",
      desc: "Establishing circuit limits on user track; classic out-in-out line maximizing corner radius.",
      brakeOffsetMeters: 0.0,
      apexCarryFactor: 0.98,
      trailBrakeBlend: 0.95,
      exitThrottleAggression: 0.95,
      brakeBar: "50%",
      apexBar: "50%",
      throttleBar: "60%",
    };
  }

  generateLapPath(lap, track) {
    const N = track.sampleCount;
    const usableHalfWidth = Math.max(1.8, (track.roadWidth / 2) - 1.8);
    const offsets = new Float32Array(N);

    // Dynamic racing line strategies:
    // ALL strategies maintain a STRICT ZERO OFFSET on all straights (no turns on straight roads)!
    // They optimize apex clipping depth and entry arc through actual corners.
    let strategyName = "Optimal Inside Apex (Shortest Path)";
    let phaseBadge = "Inside Apex";
    let apexWeight = 1.0;

    if (lap === 1) {
      strategyName = "Geometric Shortest Path (Baseline)";
      phaseBadge = "Inside Apex";
      apexWeight = 0.88;
    } else if (lap === 2) {
      strategyName = "Deep Late-Apex Strategy";
      phaseBadge = "Late Apex";
      apexWeight = 0.95;
    } else if (lap === 3) {
      strategyName = "Geometric Maximum Radius";
      phaseBadge = "Max Arc";
      apexWeight = 0.82;
    } else {
      strategyName = `Heuristic Convergence (Lap ${lap})`;
      phaseBadge = "Optimized Line";
      apexWeight = 0.90;
    }

    this.currentParams.pathStyle = strategyName;
    this.currentParams.name = strategyName;
    this.currentParams.phaseBadge = phaseBadge;

    for (let i = 0; i < N; i++) {
      const curr = track.samples[i];
      // Corner detection: Curvature must exceed 0.009 (radius < 110m).
      // On ALL straightaways (curvature <= 0.009), offset is STRICTLY 0.0!
      if (curr.curvature > 0.009) {
        const t = Math.min(1.0, (curr.curvature - 0.009) / (0.022 - 0.009));
        const smooth = t * t * (3 - 2 * t);
        const turnDir = Math.sign(curr.signedCurvature);
        const maxApexClip = 1.45 * apexWeight; // Gentle, smooth clipping without lateral jerk
        offsets[i] = turnDir * maxApexClip * smooth;
      } else {
        offsets[i] = 0.0; // PURE STRAIGHT LINE (ZERO TURNS ON STRAIGHTS)
      }
    }

    // Anchor start/finish grid (offset = 0) so car starts dead straight
    const startZone = Math.floor(N * 0.06);
    for (let i = 0; i < startZone; i++) {
      const blend = i / startZone;
      offsets[i] *= blend;
      offsets[(N - 1 - i)] *= blend;
    }
    offsets[0] = 0.0;

    // Smooth transitions between corners and straights
    let smoothed = new Float32Array(offsets);
    for (let pass = 0; pass < 24; pass++) {
      const temp = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const prev = smoothed[(i - 1 + N) % N];
        const curr = smoothed[i];
        const next = smoothed[(i + 1) % N];
        temp[i] = prev * 0.25 + curr * 0.5 + next * 0.25;
      }
      smoothed = temp;
    }
    smoothed[0] = 0.0;

    this.currentPathOffsets = smoothed;
    track.activePathOffsets = smoothed;
    track.updateRacingLineMesh(smoothed);
    return smoothed;
  }

  startLap(lap, track) {
    this.lapNumber = lap;
    if (track) {
      this.generateLapPath(lap, track);
      this.buildSpeedProfile(track);
    }
  }

  buildSpeedProfile(track) {
    const n = track.sampleCount;
    const grip = track.app?.tireGrip || 1.10;
    const maxSpeed = 228 * MPH_TO_MS;
    const speeds = new Float32Array(n);
    const curvature = new Float32Array(n);
    // Sample the actual offset path, including the intervals between road samples.
    for (let i = 0; i < n; i++) {
      curvature[i] = Math.max(track.getPathCurvature(i / n), track.getPathCurvature((i + 0.5) / n));
    }
    for (let i = 0; i < n; i++) {
      const k = Math.max(curvature[(i - 1 + n) % n], curvature[i], curvature[(i + 1) % n]);
      let low = 0, high = maxSpeed;
      for (let iteration = 0; iteration < 24; iteration++) {
        const v = (low + high) / 2;
        const available = Math.min(54, grip * G_ACCEL * (1 + Math.min(4.4, (v / 26) ** 2 * 0.52)));
        if (v * v * k <= available * 0.90) low = v;
        else high = v;
      }
      speeds[i] = low;
    }
    // Backward braking envelope across the closed lap, with a conservative
    // deceleration budget that leaves room for steering and acceleration ramping.
    const cornerSpeeds = speeds.slice();
    const ds = track.totalLength / n;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[(i + 1) % n] ** 2 + 2 * 24 * ds));
      }
    }
    this.speedProfile = speeds;
    track.overviewGuidance = Uint8Array.from(speeds, (speed, i) => {
      if (speed < cornerSpeeds[i] - 2) return 2;
      return cornerSpeeds[i] < maxSpeed * 0.9 ? 1 : 0;
    });
  }

  getPlannedSpeed(progress, track) {
    const index = ((progress % 1 + 1) % 1) * track.sampleCount;
    const i = Math.floor(index);
    return THREE.MathUtils.lerp(this.speedProfile[i], this.speedProfile[(i + 1) % track.sampleCount], index - i);
  }

  evaluateLap(lapTime) {
    const isPB = lapTime < this.bestLapTime;
    const delta = this.bestLapTime === Infinity ? 0 : (lapTime - this.bestLapTime);

    const record = {
      lap: this.lapNumber,
      time: lapTime,
      delta: delta,
      isPB: isPB,
      strategy: this.currentParams.pathStyle || this.currentParams.name,
      action: this.currentParams.phaseBadge,
      clean: true,
      params: { ...this.currentParams },
    };

    this.history.push(record);

    if (isPB) {
      this.bestLapTime = lapTime;
      this.bestLapNumber = this.lapNumber;
      this.bestParams = { ...this.currentParams };
      if (this.currentPathOffsets) {
        this.bestPathOffsets = new Float32Array(this.currentPathOffsets);
      }
      this.explorationTemp = Math.max(0.08, this.explorationTemp * 0.90);
    }

    return record;
  }
}

/* ==========================================================================
   Main Application Orchestrator for Assignment 3 (Windows 11 Edition)
   ========================================================================== */

/* ==========================================================================
   Beta: High-Performance GPU Particle System (Tire Smoke & Skidmark Trails)
   ========================================================================== */

class TireSmokeAndSkidSystem {
  constructor(scene) {
    this.scene = scene;
    this.maxParticles = 120;
    this.particles = [];
    this.enabled = true;

    // Soft circular radial smoke texture
    const smokeCanvas = document.createElement("canvas");
    smokeCanvas.width = 64;
    smokeCanvas.height = 64;
    const ctx = smokeCanvas.getContext("2d");
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(235, 240, 248, 0.75)");
    grad.addColorStop(0.35, "rgba(210, 220, 230, 0.45)");
    grad.addColorStop(0.7, "rgba(180, 190, 205, 0.15)");
    grad.addColorStop(1, "rgba(160, 175, 195, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const smokeTex = new THREE.CanvasTexture(smokeCanvas);

    const geom = new THREE.PlaneGeometry(1, 1);
    this.smokeMat = new THREE.MeshBasicMaterial({
      map: smokeTex,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.instancedMesh = new THREE.InstancedMesh(geom, this.smokeMat, this.maxParticles);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.frustumCulled = false;
    this.scene.add(this.instancedMesh);

    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        scale: 0.2,
        life: 0,
        maxLife: 0.7,
      });
      this.instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.particleIndex = 0;

    // Dynamic Skidmark Line Segments
    this.maxSkidPoints = 180;
    this.skidPositions = new Float32Array(this.maxSkidPoints * 3);
    this.skidGeom = new THREE.BufferGeometry();
    this.skidGeom.setAttribute("position", new THREE.BufferAttribute(this.skidPositions, 3));
    const skidMat = new THREE.LineBasicMaterial({
      color: 0x121418,
      linewidth: 3,
      transparent: true,
      opacity: 0.78,
    });
    this.skidLine = new THREE.LineSegments(this.skidGeom, skidMat);
    this.skidLine.frustumCulled = false;
    this.scene.add(this.skidLine);
    this.skidWriteIndex = 0;
  }

  emitSmoke(pos, velOffset, intensity = 1.0) {
    if (!this.enabled) return;
    const p = this.particles[this.particleIndex];
    p.active = true;
    p.pos.copy(pos);
    p.vel.set(
      (Math.random() - 0.5) * 0.4 + velOffset.x * 0.15,
      0.45 + Math.random() * 0.55,
      (Math.random() - 0.5) * 0.4 + velOffset.z * 0.15
    );
    p.scale = 0.35 + Math.random() * 0.25;
    p.life = 0.65 + Math.random() * 0.25;
    p.maxLife = p.life;

    this.particleIndex = (this.particleIndex + 1) % this.maxParticles;
  }

  addSkidmarkSegment(p1, p2) {
    if (!this.enabled) return;
    const idx = (this.skidWriteIndex * 6) % (this.maxSkidPoints * 3);
    this.skidPositions[idx] = p1.x;
    this.skidPositions[idx + 1] = p1.y + 0.04;
    this.skidPositions[idx + 2] = p1.z;
    this.skidPositions[idx + 3] = p2.x;
    this.skidPositions[idx + 4] = p2.y + 0.04;
    this.skidPositions[idx + 5] = p2.z;
    this.skidWriteIndex = (this.skidWriteIndex + 1) % (this.maxSkidPoints / 2);
    this.skidGeom.attributes.position.needsUpdate = true;
  }

  update(dt, camera) {
    const dummy = this.dummy || (this.dummy = new THREE.Object3D());
    let needsUpdate = false;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (p.active) {
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          this.instancedMesh.setMatrixAt(i, dummy.matrix);
          needsUpdate = true;
        } else {
          p.pos.addScaledVector(p.vel, dt);
          p.scale += dt * 1.5;
          dummy.position.copy(p.pos);
          dummy.scale.set(p.scale, p.scale, p.scale);
          dummy.quaternion.copy(camera.quaternion);
          dummy.updateMatrix();
          this.instancedMesh.setMatrixAt(i, dummy.matrix);
          needsUpdate = true;
        }
      }
    }
    if (needsUpdate) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear() {
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i].active = false;
      this.instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    this.skidPositions.fill(0);
    this.skidGeom.attributes.position.needsUpdate = true;
  }
}

/* ==========================================================================
   Beta: Live Telemetry Canvas Waveform Graph (90 FPS Oscillogram)
   ========================================================================== */

class LiveTelemetryGraph {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.bufferSize = 75;
    this.speedHistory = new Float32Array(this.bufferSize);
    this.throttleHistory = new Float32Array(this.bufferSize);
    this.brakeHistory = new Float32Array(this.bufferSize);
    this.latGHistory = new Float32Array(this.bufferSize);
    this.head = 0;
  }

  record(speedNorm, throttle, brake, latGNorm) {
    if (!this.ctx) return;
    this.speedHistory[this.head] = Math.max(0, Math.min(1, speedNorm));
    this.throttleHistory[this.head] = Math.max(0, Math.min(1, throttle));
    this.brakeHistory[this.head] = Math.max(0, Math.min(1, brake));
    this.latGHistory[this.head] = Math.max(-1, Math.min(1, latGNorm));
    this.head = (this.head + 1) % this.bufferSize;
  }

  draw() {
    if (!this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.fillStyle = "#070a10";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0.25; y <= 0.75; y += 0.25) {
      const py = Math.round(h * y);
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    const N = this.bufferSize;
    const dx = w / (N - 1);

    const drawLine = (history, color, scaleY, offsetY) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const ringIdx = (this.head + i) % N;
        const val = history[ringIdx];
        const px = i * dx;
        const py = h - (val * scaleY + offsetY) * h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    drawLine(this.speedHistory, "#00f2fe", 0.90, 0.05);
    drawLine(this.throttleHistory, "#10b981", 0.90, 0.05);
    drawLine(this.brakeHistory, "#ef4444", 0.90, 0.05);
    drawLine(this.latGHistory, "#f59e0b", 0.42, 0.50);

    ctx.strokeStyle = "rgba(0, 242, 254, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w - 1, 0);
    ctx.lineTo(w - 1, h);
    ctx.stroke();
  }
}

class RacingGenesisApp {
  constructor() {
    this.container = $("webgl-container") || document.body;

    // 1. Realistic Three.js Daylight Scene Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x82bcee);
    this.scene.fog = new THREE.FogExp2(0xcce2f5, 0.00018);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.6, 35000);
    this.camera.position.set(0, 15, -30);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        logarithmicDepthBuffer: true,
        powerPreference: "high-performance",
      });
    } catch (_) {
      try {
        this.renderer = new THREE.WebGLRenderer({
          antialias: true,
          powerPreference: "high-performance",
        });
      } catch (err) {
        this.renderer = {
          domElement: document.createElement("canvas"),
          shadowMap: {},
          setSize: () => {},
          setPixelRatio: () => {},
          render: () => {},
        };
      }
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    // 2. Setup Lighting & Terrain
    this.setupLighting();
    this.setupRealisticWorld();

    // 3. Track, Car with In-Car 3D Dashboard, Camera & Audio
    this.track = new Track3D(this.scene);
    this.track.app = this;
    this.updateEnvironmentForTrack(this.track.getBoundingRadius(), this.track.totalLength);
    this.car = new RaceCar3D(this.scene);
    this.previousRacePosition = new THREE.Vector3();
    this.chasePosition = new THREE.Vector3();
    this.savedCarPosition = new THREE.Vector3();
    this.cameraManager = new CameraManager3D(this.camera, this.renderer.domElement);
    this.cameraManager.setTrack(this.track);
    this.trackOverview = new TrackOverview($("trackOverviewCanvas"), $("trackOverviewLegend"));
    this.audio = new RacingEngineSound();

    // Tire effects and telemetry
    this.tireSmokeSystem = new TireSmokeAndSkidSystem(this.scene);
    this.telemetryGraph = new LiveTelemetryGraph("telemetryGraphCanvas");
    this.isOverCurb = false;
    this.prevSkidLeft = null;
    this.prevSkidRight = null;

    // 4. Raycasting & Handle Dragging
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.activeHandleIndex = null;
    this.isDraggingHandle = false;
    this.hoveredHandleIndex = null;
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.groundHit = new THREE.Vector3();

    // 5. Physics & AI Driver State
    this.driverAI = new HeuristicNPCDriver();
    this.driverAI.startLap(1, this.track);
    this.state = "READY";
    this.physicsAccumulator = 0;
    this.manualLapDistance = 0;
    this.progress = 0;
    this.currentLap = 1;
    this.lapTime = 0;
    this.speed = 0; // m/s
    this.lateralG = 0;
    this.targetSpeed = 0;
    this.steerAngle = 0;
    this.tireGrip = 1.10;
    this.totalLaps = 5;
    this.timeScale = 1;
    this.aiState = "IDLE";
    this.currentRPM = 4500;
    this.currentGear = 1;
    this.records = [];
    this.fastestRecord = null;
    this.throttleLevel = 0;
    this.brakeLevel = 0;
    this.currentAccel = 0; // Continuous jerk-limited acceleration
    this.currentRPM = 4500;
    this.currentGear = 1;

    // MVP 2.0 Session Tracking & Input
    this.maxSessionSpeed = 0;
    this.maxSessionG = 0;
    this.driverMode = "ai";
    this.manualHeading = 0;
    this.keysDown = {};

    // Performance FPS Meter
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();

    // 6. Connect UI & Windows 11 Panel Drawer Controls
    this.bindUI();
    this.reset();

    // Initial HUD & Dashboard Render
    this.updateHUD();

    // 7. Start the display-synchronized render loop.
    this.startAnimationLoop();
  }

  setupLighting() {
    const ambient = new THREE.HemisphereLight(0xd8eeff, 0x486444, 0.95);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfffbf2, 1.45);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(80, 110, 60);
    this.shadowRight = new THREE.Vector3(this.sunOffset.z, 0, -this.sunOffset.x).normalize();
    this.shadowUp = new THREE.Vector3().crossVectors(this.sunOffset, this.shadowRight).normalize();
    sun.position.copy(this.sunOffset);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 320;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);
  }

  setupRealisticWorld() {
    const grassTex = createGrassTexture();
    const groundGeom = new THREE.PlaneGeometry(45000, 45000);
    const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.92, metalness: 0.05 });
    grassTex.repeat.set(220, 220);
    this.groundMesh = new THREE.Mesh(groundGeom, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    const skyGeom = new THREE.SphereGeometry(30000, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: createSkyGradientTexture(), side: THREE.BackSide });
    this.skyDome = new THREE.Mesh(skyGeom, skyMat);
    this.scene.add(this.skyDome);

    this.mountainGroup = new THREE.Group();
    this.scene.add(this.mountainGroup);

    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);
  }

  updateEnvironmentForTrack(boundingRadius, trackLength) {
    if (!this.treeGroup || !this.mountainGroup) return;

    disposeGroupContents(this.treeGroup);
    disposeGroupContents(this.mountainGroup);
    if (this.cameraManager && !this.isDraggingHandle) this.cameraManager.setTrack(this.track);

    const trackR = Math.max(160, boundingRadius || 400);

    // 1. Distant Mountains scaled & placed relative to track size
    const mountainCount = 42;
    const mountainRadius = Math.max(4500, trackR * 3.8);
    const mMat = new THREE.MeshStandardMaterial({ color: 0x4a5e44, roughness: 0.95 });
    for (let m = 0; m < mountainCount; m++) {
      const angle = (m / mountainCount) * Math.PI * 2;
      const height = Math.max(600, trackR * 0.9) + (Math.sin(m * 2.5) + 1) * Math.max(400, trackR * 0.6);
      const mGeom = new THREE.ConeGeometry(Math.max(650, trackR * 0.8), height, 6);
      const mountain = new THREE.Mesh(mGeom, mMat);
      mountain.position.set(Math.cos(angle) * mountainRadius, height * 0.45, Math.sin(angle) * mountainRadius);
      this.mountainGroup.add(mountain);
    }

    // 2. Parkland Pine Trees moving relative to track perimeter
    const foilMat = new THREE.MeshStandardMaterial({ color: 0x1f5424, roughness: 0.85 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a321c, roughness: 0.9 });
    const trunkGeom = new THREE.CylinderGeometry(0.55, 0.75, 5.0, 8);
    const coneGeom = new THREE.ConeGeometry(4.0, 6.0, 8);

    const makeTree = (x, z, scale = 1.0) => {
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);
      tree.scale.setScalar(scale);

      const trunk = new THREE.Mesh(trunkGeom, trunkMat);
      trunk.position.y = 2.5;
      trunk.castShadow = true;
      tree.add(trunk);

      for (let f = 0; f < 3; f++) {
        const cone = new THREE.Mesh(coneGeom, foilMat);
        cone.scale.setScalar(1.0 - f * 0.2);
        cone.position.y = 5.2 + f * 3.2;
        cone.castShadow = true;
        tree.add(cone);
      }
      return tree;
    };

    // Concentric outer tree lines following the track perimeter
    const ring1Count = 42;
    const ring1Radius = trackR + 55;
    for (let t = 0; t < ring1Count; t++) {
      const angle = (t / ring1Count) * Math.PI * 2 + Math.sin(t * 3) * 0.12;
      const rad = ring1Radius + Math.cos(t * 4) * 20;
      const tx = Math.cos(angle) * rad;
      const tz = Math.sin(angle) * rad;
      const sc = 0.9 + (Math.sin(t * 5) + 1) * 0.3;
      this.treeGroup.add(makeTree(tx, tz, sc));
    }

    const ring2Count = 56;
    const ring2Radius = trackR + 115;
    for (let t = 0; t < ring2Count; t++) {
      const angle = (t / ring2Count) * Math.PI * 2 + Math.cos(t * 2.5) * 0.15;
      const rad = ring2Radius + Math.sin(t * 3) * 35;
      const tx = Math.cos(angle) * rad;
      const tz = Math.sin(angle) * rad;
      const sc = 1.0 + (Math.cos(t * 4) + 1) * 0.35;
      this.treeGroup.add(makeTree(tx, tz, sc));
    }

    // 3. Scenic Infield Tree Groves (placed in interior clearings safely away from track)
    if (this.track && this.track.samples && this.track.samples.length > 0) {
      const roadHalfW = this.track.roadWidth / 2;
      const infieldAttempts = 16;
      for (let a = 0; a < infieldAttempts; a++) {
        const ang = (a / infieldAttempts) * Math.PI * 2 + 0.3;
        const rad = trackR * (0.3 + (a % 3) * 0.18);
        const gx = Math.cos(ang) * rad;
        const gz = Math.sin(ang) * rad;

        // Check distance to closest track sample: must be at least roadHalfW + 22.0m away
        let minDistSq = Infinity;
        for (let s = 0; s < this.track.samples.length; s += 6) {
          const sp = this.track.samples[s].position;
          const d2 = (gx - sp.x) * (gx - sp.x) + (gz - sp.z) * (gz - sp.z);
          if (d2 < minDistSq) minDistSq = d2;
        }

        if (minDistSq > (roadHalfW + 22.0) * (roadHalfW + 22.0)) {
          // Cluster of 3 trees in grove
          this.treeGroup.add(makeTree(gx, gz, 1.0));
          this.treeGroup.add(makeTree(gx + 9.0, gz + 4.0, 0.85));
          this.treeGroup.add(makeTree(gx - 6.0, gz + 8.0, 1.15));
        }
      }
    }
  }

  bindUI() {
    // Windows 11 Drawer Panel Open/Close Toggles
    const leftPanel = $("leftPanel");
    const rightPanel = $("rightPanel");
    const btnToggleLeft = $("btnToggleLeft");
    const btnToggleRight = $("btnToggleRight");
    const btnCloseLeft = $("btnCloseLeft");
    const btnCloseRight = $("btnCloseRight");

    const togglePanel = (panel, btn) => {
      if (!panel) return;
      this.setDrawerCollapsed(panel, btn, !panel.classList.contains("collapsed"));
      if (this.cameraManager.isTrackOrbit) this.cameraManager.fitTrack();
    };

    if (btnToggleLeft) btnToggleLeft.addEventListener("click", () => togglePanel(leftPanel, btnToggleLeft));
    if (btnToggleRight) btnToggleRight.addEventListener("click", () => togglePanel(rightPanel, btnToggleRight));
    if (btnCloseLeft) btnCloseLeft.addEventListener("click", () => togglePanel(leftPanel, btnToggleLeft));
    if (btnCloseRight) btnCloseRight.addEventListener("click", () => togglePanel(rightPanel, btnToggleRight));

    // Keyboard Shortcuts: [ to toggle Track Editor, ] to toggle Telemetry
    window.addEventListener("keydown", (e) => {
      if (e.key === "[") togglePanel(leftPanel, btnToggleLeft);
      if (e.key === "]") togglePanel(rightPanel, btnToggleRight);
    });

    // Beta Feature Toggles
    const btnToggleFX = $("btnToggleFX");
    if (btnToggleFX) {
      btnToggleFX.addEventListener("click", () => {
        if (!this.tireSmokeSystem) return;
        this.tireSmokeSystem.enabled = !this.tireSmokeSystem.enabled;
        btnToggleFX.classList.toggle("active", this.tireSmokeSystem.enabled);
        btnToggleFX.textContent = this.tireSmokeSystem.enabled ? "💨 Smoke & FX: ON" : "💨 Smoke & FX: OFF";
        if (!this.tireSmokeSystem.enabled) {
          this.tireSmokeSystem.clear();
        }
      });
    }

    // Camera Switcher
    document.querySelectorAll(".cam-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.setCamera(btn.dataset.cam));
    });
    $("btnAerialFollow").addEventListener("click", () => this.setCamera("aerial"));
    $("btnAerialCircuit").addEventListener("click", () => this.setCamera("orbit"));
    $("btnAerialMap").addEventListener("click", () => this.setCamera("map"));

    // Sliders & Track Length (1,000m - 10,000m)
    const syncOut = () => {
      const lenVal = Math.round(Number($("scaleSlider").value) || (this.track ? this.track.totalLength : 5000));
      $("scaleOut").value = `${lenVal.toLocaleString()} m (${(lenVal / 1000).toFixed(2)} km)`;
      if ($("lengthInput") && Number($("lengthInput").value) !== lenVal) {
        $("lengthInput").value = lenVal;
      }
      $("widthOut").value = `${$("widthSlider").value} m`;
      $("curveOut").value = Number($("curveSlider").value).toFixed(2);
      $("gripOut").value = Number($("gripSlider").value).toFixed(2);
      const lenDisplay = $("trackLengthDisplay");
      if (lenDisplay) lenDisplay.textContent = `${lenVal.toLocaleString()} m`;
    };

    $("scaleSlider").addEventListener("input", syncOut);
    $("scaleSlider").addEventListener("change", (e) => {
      const len = Number(e.target.value);
      this.track.scaleTrackToTargetLength(len);
      this.reset();
    });

    const lengthInput = $("lengthInput");
    if (lengthInput) {
      lengthInput.addEventListener("input", (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1000 || val > 10000) return;
        $("scaleSlider").value = val;
      });
      lengthInput.addEventListener("change", (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1000) val = 1000;
        if (val > 10000) val = 10000;
        e.target.value = val;
        $("scaleSlider").value = val;
        syncOut();
        this.track.scaleTrackToTargetLength(val);
        this.reset();
      });
    }

    ["widthSlider", "curveSlider", "gripSlider"].forEach((id) => {
      $(id).addEventListener("input", syncOut);
    });

    $("btnRebuild").addEventListener("click", () => {
      this.tireGrip = Number($("gripSlider").value);
      this.track.roadWidth = Number($("widthSlider").value);
      this.track.curveStrength = Number($("curveSlider").value);
      this.track.initControlPoints();
      this.track.build3DHandles();
      this.track.scaleTrackToTargetLength(Number($("scaleSlider").value));
      this.reset();
    });

    // F1 Circuit Presets
    document.querySelectorAll("#f1PresetContainer .f1-preset-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#f1PresetContainer .f1-preset-pill").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.track.loadF1Preset(btn.dataset.preset);
      });
    });

    $("btnRandomize").addEventListener("click", () => {
      this.track.randomize();
      document.querySelectorAll("#f1PresetContainer .f1-preset-pill").forEach(btn => btn.classList.remove("active"));
      this.reset();
    });

    $("btnEditHandles").addEventListener("click", () => {
      this.track.toggleEditHandles();
      if (this.track.editHandlesVisible && this.cameraManager.mode !== "orbit") this.setCamera("orbit");
    });

    // Stress testing buttons
    let isDense = false;
    $("btnStressGeom").addEventListener("click", () => {
      isDense = !isDense;
      this.track.setStressGeometry(isDense);
      $("btnStressGeom").classList.toggle("btn-primary", isDense);
      $("btnStressGeom").textContent = isDense ? "Dense Stress: ON" : "Dense Geometry Stress";
      this.reset();
    });

    $("btnStressCurve").addEventListener("click", () => {
      this.track.setHairpinStress();
      document.querySelectorAll("#f1PresetContainer .f1-preset-pill").forEach(btn => btn.classList.remove("active"));
      this.reset();
    });

    const lapInput = $("lapInput");
    if (lapInput) {
      lapInput.value = this.totalLaps;
      const handleLapCommit = () => {
        let clean = String(lapInput.value).replace(/[^0-9]/g, "");
        let val = parseInt(clean, 10);
        if (isNaN(val) || val < 1) val = 1;
        lapInput.value = val;
        this.totalLaps = val;
        this.updateHUD();
      };
      lapInput.addEventListener("change", handleLapCommit);
      lapInput.addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, "");
        if (e.target.value !== "") {
          let val = parseInt(e.target.value, 10);
          if (val >= 1) {
            this.totalLaps = val;
            this.updateHUD();
          }
        }
      });
    }

    $("speedSelect").addEventListener("change", (e) => {
      this.timeScale = Number(e.target.value);
    });

    $("btnStart").addEventListener("click", () => this.start());
    $("btnPause").addEventListener("click", () => this.togglePause());
    $("btnReset").addEventListener("click", () => this.reset());

    $("btnAudio").addEventListener("click", () => {
      const on = this.audio.toggle();
      $("btnAudio").textContent = on ? "🔊 Audio: ON" : "🔊 Audio: OFF";
      $("btnAudio").classList.toggle("win11-primary-btn", on);
    });

    // In-Simulation Driver Mode Switchers (Header Segmented & Left Panel)
    const setDriverMode = (mode) => {
      const previousMode = this.driverMode;
      this.driverMode = mode;
      this.previousRaceProgress = null;
      this.currentAccel = 0;
      this.steerAngle = 0;
      this.isOverCurb = false;
      this.car.carGroup.rotation.z = 0;
      if (mode === "ai") this.speed = Math.max(0, this.speed);
      if (mode === "manual" && previousMode !== "manual") this.manualLapDistance = this.progress;
      if (mode === "manual" && this.car) {
        this.manualHeading = this.car.carGroup.rotation.y;
      }
      document.querySelectorAll("#driverModeSwitcher .mode-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === mode);
      });
      document.querySelectorAll("#panelDriverModeGrid .f1-preset-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === mode);
      });
      const badge = $("aiStateDisplay");
      if (badge) {
        badge.textContent = mode === "manual" ? "MANUAL (WASD)" : "AI AUTOPILOT";
      }
    };

    document.querySelectorAll("#driverModeSwitcher .mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => setDriverMode(btn.dataset.mode));
    });

    document.querySelectorAll("#panelDriverModeGrid .f1-preset-pill").forEach((btn) => {
      btn.addEventListener("click", () => setDriverMode(btn.dataset.mode));
    });

    // Pause Modal Buttons
    $("btnResumeRace").addEventListener("click", () => this.resume());
    $("btnRestartRace").addEventListener("click", () => {
      if (this.state !== "PAUSED" || !$("pauseModal").open) return;
      this.reset();
      this.start();
    });
    $("pauseModal").addEventListener("cancel", (e) => {
      e.preventDefault();
      this.resume();
    });

    $("btnFinishRestart").addEventListener("click", () => {
      if (this.state === "COMPLETE" && $("finishModal").open) this.start();
    });
    $("finishModal").addEventListener("cancel", (e) => e.preventDefault());

    const btnFinishSandbox = $("btnFinishSandbox");
    if (btnFinishSandbox) {
      btnFinishSandbox.addEventListener("click", () => {
        if (this.state !== "COMPLETE" || !$("finishModal").open) return;
        this.hideFinishScreen();
        this.track.toggleEditHandles();
        if (this.track.editHandlesVisible) this.setCamera("orbit");
      });
    }

    // Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.code === "Escape") {
        e.preventDefault();
        if (!e.repeat) this.togglePause();
        return;
      }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName)) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      this.keysDown[e.code] = true;
      if (this.driverMode === "manual" && this.state === "READY") {
        if (e.code === "KeyW" || e.code === "ArrowUp" || e.code === "KeyS" || e.code === "ArrowDown") {
          this.start();
        }
      }
      if (e.code === "KeyC") {
        const current = this.cameraManager.mode;
        this.setCamera(current === "chase" ? "hood" : current === "hood" ? "aerial" : "chase");
      } else if (e.code === "KeyM") {
        const on = this.audio.toggle();
        $("btnAudio").textContent = on ? "🔊 Audio: ON" : "🔊 Audio: OFF";
        $("btnAudio").classList.toggle("win11-primary-btn", on);
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keysDown[e.code] = false;
    });

    window.addEventListener("blur", () => {
      this.keysDown = {};
      this.pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
    });
    this.setupHandleInteractions();

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cameraManager.fitTrack(1, true);
    });

    syncOut();
    this.updateHUD();
  }

  setDrawerCollapsed(panel, button, collapsed) {
    panel.classList.toggle("collapsed", collapsed);
    button?.classList.toggle("active", !collapsed);
    button?.setAttribute("aria-expanded", String(!collapsed));
    panel.inert = collapsed;
  }

  setCamera(mode) {
    if (this.cameraManager.mode !== mode) this.previousRaceProgress = null;
    const circuitShot = mode === "orbit" && !this.track.editHandlesVisible;
    if (circuitShot && !this.circuitDrawers) {
      this.circuitDrawers = [[$("leftPanel"), $("btnToggleLeft")], [$("rightPanel"), $("btnToggleRight")]]
        .map(([panel, button]) => {
          const collapsed = panel.classList.contains("collapsed");
          this.setDrawerCollapsed(panel, button, true);
          return { panel, button, collapsed };
        });
    } else if (!circuitShot && this.circuitDrawers) {
      for (const { panel, button, collapsed } of this.circuitDrawers) {
        this.setDrawerCollapsed(panel, button, collapsed);
      }
      this.circuitDrawers = null;
    }
    this.cameraManager.setMode(mode);
    $("liveDeltaBadge").hidden = circuitShot;
    const headerMode = this.cameraManager.isAerialView ? "aerial" : mode;
    document.querySelectorAll(".cam-btn").forEach(btn => {
      const active = btn.dataset.cam === headerMode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    $("aerialControls").hidden = !this.cameraManager.isAerialView;
    $("btnAerialFollow").setAttribute("aria-pressed", String(mode === "aerial"));
    $("btnAerialCircuit").setAttribute("aria-pressed", String(mode === "orbit"));
    $("btnAerialMap").setAttribute("aria-pressed", String(mode === "map"));
  }

  setupHandleInteractions() {
    const getPointerCoords = (clientX, clientY) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -((clientY - rect.top) / rect.height) * 2 + 1,
      };
    };

    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      if (!this.track.editHandlesVisible) return;
      const coords = getPointerCoords(e.clientX, e.clientY);
      this.mouse.set(coords.x, coords.y);
      this.raycaster.setFromCamera(this.mouse, this.camera);

      const intersects = this.raycaster.intersectObjects(this.track.handleMeshes, false);
      if (intersects.length > 0) {
        const handle = intersects[0].object;
        this.activeHandleIndex = handle.userData.anchorIndex;
        this.isDraggingHandle = true;
        this.cameraManager.locked = true;
        try {
          this.renderer.domElement.setPointerCapture(e.pointerId);
        } catch (_) {}
        this.track.highlightHandle(this.activeHandleIndex, true, false);
        this.renderer.domElement.style.cursor = "grabbing";
        e.stopPropagation();
        e.preventDefault();
      }
    });

    this.renderer.domElement.addEventListener("pointermove", (e) => {
      const coords = getPointerCoords(e.clientX, e.clientY);
      this.mouse.set(coords.x, coords.y);

      if (this.isDraggingHandle && this.activeHandleIndex !== null) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        if (this.raycaster.ray.intersectPlane(this.groundPlane, this.groundHit)) {
          this.track.moveAnchor(this.activeHandleIndex, this.groundHit.x, this.groundHit.z);
          if (this.state === "READY") {
            const startS = this.track.samples[0];
            this.car.carGroup.position.copy(startS.position);
            this.car.carGroup.rotation.y = Math.atan2(startS.tangent.x, startS.tangent.z);
          }
        }
        this.renderer.domElement.style.cursor = "grabbing";
      } else if (this.track.editHandlesVisible) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.track.handleMeshes, false);
        if (intersects.length > 0) {
          const idx = intersects[0].object.userData.anchorIndex;
          if (this.hoveredHandleIndex !== idx) {
            if (this.hoveredHandleIndex !== null) {
              this.track.highlightHandle(this.hoveredHandleIndex, false, false);
            }
            this.hoveredHandleIndex = idx;
            this.track.highlightHandle(idx, false, true);
          }
          this.renderer.domElement.style.cursor = "grab";
        } else {
          if (this.hoveredHandleIndex !== null) {
            this.track.highlightHandle(this.hoveredHandleIndex, false, false);
            this.hoveredHandleIndex = null;
          }
          this.renderer.domElement.style.cursor = "default";
        }
      }
    });

    const releaseHandleDrag = (e) => {
      if (this.isDraggingHandle) {
        try {
          if (e && e.pointerId) this.renderer.domElement.releasePointerCapture(e.pointerId);
        } catch (_) {}
        if (this.activeHandleIndex !== null) {
          this.track.highlightHandle(this.activeHandleIndex, false, false);
        }
        this.isDraggingHandle = false;
        this.activeHandleIndex = null;
        this.cameraManager.locked = false;
        this.cameraManager.setTrack(this.track);
        this.renderer.domElement.style.cursor = "default";
        const curLen = Math.round(this.track.totalLength || 5000);
        this.track.targetLength = curLen;
        const sSlider = $("scaleSlider");
        const sInput = $("lengthInput");
        const sOut = $("scaleOut");
        if (sSlider) sSlider.value = curLen;
        if (sInput) sInput.value = curLen;
        if (sOut) sOut.value = `${curLen.toLocaleString()} m (${(curLen / 1000).toFixed(2)} km)`;
        const sLenDisp = $("trackLengthDisplay");
        if (sLenDisp) sLenDisp.textContent = `${curLen.toLocaleString()} m`;
        this.reset();
      }
    };

    this.renderer.domElement.addEventListener("pointerup", releaseHandleDrag);
    this.renderer.domElement.addEventListener("pointercancel", releaseHandleDrag);
  }

  start() {
    if (this.state === "PAUSED") return this.resume();
    if (this.state === "COMPLETE") this.reset();
    if (this.state !== "READY") return;

    // F1 Signal Lights Starting Countdown: Red 1..5 -> Blinking Red -> Green (GO!)
    this.state = "COUNTDOWN";
    this.updatePauseControl();
    this.countdownTimer = 0;
    this.speed = 0;
    this.currentAccel = 0;
    setElText("simStateText", "GRID START");
    this.showStartLightsHUD(true);
    if (this.track) this.track.setGantryLights("OFF");
  }

  updateStartCountdown(dt) {
    if (this.state === "COUNTDOWN") {
      this.countdownTimer += dt;
      const t = this.countdownTimer;

      // Phase 1: Sequential Red Lights (1 to 5) (0.0s to 2.5s)
      if (t < 2.5) {
        const count = Math.min(5, Math.floor(t / 0.5) + 1);
        if (this.track) this.track.setGantryLights("RED_COUNT", count);
        this.updateStartLightsHUD("RED_COUNT", count, `GRID FORMING: LIGHT ${count} OF 5`);
        this.aiState = `START: RED LIGHT ${count}`;
      }
      // Phase 2: Blinking Red Lights (2.5s to 4.0s)
      else if (t < 4.0) {
        const blinkOn = Math.floor((t - 2.5) * 4.5) % 2 === 0;
        if (this.track) this.track.setGantryLights(blinkOn ? "ALL_RED" : "OFF");
        this.updateStartLightsHUD("BLINK_RED", blinkOn, "HOLD REVS! BLINKING RED...");
        this.aiState = "START: BLINKING RED";
      }
      // Phase 3: Green Lights (t >= 4.0s) - LIGHTS OUT / GREEN!
      else {
        if (this.track) this.track.setGantryLights("GREEN");
        this.updateStartLightsHUD("GREEN", 5, "LIGHTS OUT! GO GO GO! 🏁");
        this.state = "RUNNING";
        this.greenTimer = 3.2; // Keep green lights shining for 3.2s
        setElText("simStateText", "RUNNING");
        this.aiState = "LAUNCH ACCELERATION";
        // Audio is enabled only by the explicit audio button/user gesture.
      }
    } else if (this.state !== "PAUSED" && this.greenTimer > 0) {
      this.greenTimer -= dt;
      if (this.greenTimer <= 0) {
        if (this.track) this.track.setGantryLights("OFF");
        this.showStartLightsHUD(false);
      }
    }
  }

  showStartLightsHUD(show) {
    const el = $("f1StartLightsOverlay");
    if (el) {
      if (show) el.classList.add("visible");
      else el.classList.remove("visible");
    }
  }

  updateStartLightsHUD(mode, val, labelText) {
    const el = $("f1StartLightsOverlay");
    if (el && !el.classList.contains("visible")) {
      el.classList.add("visible");
    }
    const lbl = $("f1StartLightsLabel");
    if (lbl && labelText) lbl.textContent = labelText;

    for (let i = 0; i < 5; i++) {
      const pod = $(`hudPod${i}`);
      if (!pod) continue;
      pod.classList.remove("active-red", "active-green");

      if (mode === "RED_COUNT") {
        if (i < val) pod.classList.add("active-red");
      } else if (mode === "BLINK_RED") {
        if (val) pod.classList.add("active-red");
      } else if (mode === "GREEN") {
        pod.classList.add("active-green");
      }
    }
  }

  togglePause() {
    if (this.state === "PAUSED") this.resume();
    else this.pause();
  }

  pause() {
    if (!["RUNNING", "COUNTDOWN", "CELEBRATION", "RESUMING"].includes(this.state)) return;
    if (this.state !== "RESUMING") this.resumeState = this.state;
    $("resumeCountdown").hidden = true;
    this.state = "PAUSED";
    this.keysDown = {};
    const modal = $("pauseModal");
    if (!modal.open) modal.showModal();
    this.updatePauseControl();
    $("btnResumeRace")?.focus?.({ preventScroll: true });
  }

  resume() {
    if (this.state !== "PAUSED") return;
    this.state = "RESUMING";
    this.resumeTimeRemaining = 3;
    this.hidePauseMenu();
    setElText("resumeSeconds", "3");
    $("resumeCountdown").hidden = false;
    $("btnPause")?.focus?.({ preventScroll: true });
  }

  updateResumeCountdown(dt) {
    if (this.state !== "RESUMING") return;
    this.resumeTimeRemaining -= dt;
    const seconds = Math.ceil(this.resumeTimeRemaining - 1e-9);
    if (seconds > 0) {
      const label = $("resumeSeconds");
      if (label.textContent !== String(seconds)) label.textContent = String(seconds);
      return;
    }
    this.state = this.resumeState;
    this.resumeState = null;
    $("resumeCountdown").hidden = true;
    this.updatePauseControl();
  }

  hidePauseMenu() {
    const modal = $("pauseModal");
    if (modal.open) modal.close();
  }

  updatePauseControl() {
    const canStart = this.state === "READY" || this.state === "COMPLETE";
    $("btnStart").disabled = !canStart;
    $("btnPause").disabled = canStart;
  }

  showFinishScreen() {
    const modal = $("finishModal");
    if (!modal) return;

    const totalTime = this.records.reduce((acc, r) => acc + r.time, 0);
    const bestTime = this.fastestRecord ? this.fastestRecord.time : (this.records[0] ? this.records[0].time : 0);
    const topSpeedMph = Math.round((this.maxSessionSpeed || this.speed) * MS_TO_MPH);
    const maxG = (this.maxSessionG || Math.abs(this.lateralG)).toFixed(2);

    setElText("resBestLap", `${bestTime.toFixed(2)}s`);
    setElText("resTotalTime", `${totalTime.toFixed(2)}s`);
    setElText("resTopSpeed", `${topSpeedMph} mph`);
    setElText("resMaxG", `${maxG} G`);

    const tbody = $("finishTableBody");
    if (tbody) {
      if (this.records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5">No completed laps recorded</td></tr>`;
      } else {
        tbody.innerHTML = this.records.map((r) => `
          <tr>
            <td>Lap ${r.lap}</td>
            <td><b>${r.time.toFixed(2)}s</b></td>
            <td style="color:${r.delta <= 0 ? '#00e676' : '#ffaa00'}">${r.delta <= 0 ? 'PB' : '+' + r.delta.toFixed(2) + 's'}</td>
            <td>${r.strategy || 'Balanced'}</td>
            <td>${r.clean ? "Clean" : "Off track"}</td>
          </tr>
        `).join("");
      }
    }

    if (!modal.open) modal.showModal();
  }

  hideFinishScreen() {
    const modal = $("finishModal");
    if (modal?.open) modal.close();
  }

  reset() {
    this.resumeState = null;
    this.resumeTimeRemaining = 0;
    $("resumeCountdown").hidden = true;
    this.finishDelay = 0;
    this.physicsAccumulator = 0;
    this.previousRaceProgress = null;
    this.manualLapDistance = 0;
    this.lapClean = true;
    this.keysDown = {};
    this.isOverCurb = false;
    this.prevSkidLeft = this.prevSkidRight = null;
    this.hidePauseMenu();
    this.hideFinishScreen();
    $("brakingWarning")?.classList.remove("visible");
    this.tireSmokeSystem?.clear();
    if (this.telemetryGraph?.ctx) {
      for (const key of ["speedHistory", "throttleHistory", "brakeHistory", "latGHistory"]) this.telemetryGraph[key].fill(0);
      this.telemetryGraph.head = 0;
    }
    if (this.car) {
      this.car.brakeHeat = 0;
      this.car.carGroup.rotation.z = 0;
      this.car.chassisMesh.rotation.set(0, 0, 0);
      this.car.frontWheelSteerGroups.forEach(wheel => wheel.rotation.y = 0);
      this.car.steeringWheelMesh.rotation.z = 0;
      this.car.updateVisuals(0, 0, false, 0);
    }
    this.state = "READY";
    this.countdownTimer = 0;
    this.greenTimer = 0;
    this.flagCelebrationTimer = 0;
    this.showStartLightsHUD(false);
    if (this.track) this.track.setGantryLights("OFF");
    this.progress = 0;
    this.currentLap = 1;
    this.lapTime = 0;
    this.speed = 0;
    this.lateralG = 0;
    this.maxSessionSpeed = 0;
    this.maxSessionG = 0;
    this.targetSpeed = 0;
    this.steerAngle = 0;
    this.throttleLevel = 0;
    this.brakeLevel = 0;
    this.currentAccel = 0;
    this.aiState = "IDLE";
    this.currentRPM = 4500;
    this.currentGear = 1;
    this.records = [];
    this.fastestRecord = null;
    this.driverAI.reset();
    this.driverAI.startLap(1, this.track);

    if (this.car && this.track) {
      this.track.getPathPosition(0, this.car.carGroup.position);
      this.manualHeading = this.track.getTrajectoryHeading(0);
      this.car.carGroup.rotation.y = this.manualHeading;
    }

    if (this.cameraManager) {
      this.cameraManager.cameraInitialized = false;
    }

    this.updatePauseControl();
    setElText("simStateText", "READY");
    const deltaVal = $("liveDeltaVal");
    if (deltaVal) {
      deltaVal.textContent = "PROBING";
      deltaVal.className = "delta-val";
    }
    this.updateHUD();
  }

  updatePhysics(dtWall) {
    if (this.state !== "RUNNING") return;
    this.physicsAccumulator += Math.min(Math.max(dtWall, 0), 0.25) * this.timeScale;
    // Allow for frame deltas that sum to one tick within floating-point error.
    while (this.physicsAccumulator + 1e-9 >= PHYSICS_STEP && this.state === "RUNNING") {
      this.previousRaceProgress = this.progress;
      if (this.driverMode === "manual") {
        this.previousRacePosition.copy(this.car.carGroup.position);
        this.previousRaceYaw = this.car.carGroup.rotation.y;
        this.stepManualPhysics(PHYSICS_STEP);
      } else {
        this.stepPhysics(PHYSICS_STEP);
      }
      this.physicsAccumulator = Math.max(0, this.physicsAccumulator - PHYSICS_STEP);
    }
    if (this.state !== "RUNNING") this.physicsAccumulator = 0;
  }

  stepManualPhysics(dt) {
    if (typeof this.manualHeading !== "number" || isNaN(this.manualHeading)) {
      this.manualHeading = (this.car && this.car.carGroup) ? this.car.carGroup.rotation.y : 0;
    }
    const isW = !!(this.keysDown["KeyW"] || this.keysDown["ArrowUp"]);
    const isS = !!(this.keysDown["KeyS"] || this.keysDown["ArrowDown"]);
    const isA = !!(this.keysDown["KeyA"] || this.keysDown["ArrowLeft"]);
    const isD = !!(this.keysDown["KeyD"] || this.keysDown["ArrowRight"]);

    // 1. Full User Access Steering ("A" to turn left, "D" to turn right)
    let steerInput = 0;
    if (isA) steerInput += 1.0; // "A" turns left
    if (isD) steerInput -= 1.0; // "D" turns right

    const steerTarget = steerInput * 0.45;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, steerTarget, 1.0 - Math.exp(-14.0 * dt));

    // Turn heading according to user steering
    const speedMag = Math.abs(this.speed);
    const turnRate = 2.4 * Math.min(1.4, Math.max(0.45, speedMag / 12.0));
    const steerDir = (this.speed >= -0.2 ? 1 : -1);
    if (Math.abs(this.steerAngle) > 0.02) {
      this.manualHeading += this.steerAngle * turnRate * steerDir * dt;
    }
    this.car.carGroup.rotation.y = this.manualHeading;

    // 2. Full User Access Throttle & Reverse ("W" to go forward, "S" to go reverse)
    const maxForwardSpeed = 98.0; // 220 mph
    const maxReverseSpeed = -18.0; // -40 mph reverse

    if (isW) {
      if (this.speed < -0.3) {
        // Braking while in reverse
        this.speed = Math.min(0, this.speed + 42.0 * dt);
        this.brakeLevel = 1.0;
        this.throttleLevel = 0.0;
        this.aiState = "MANUAL: BRAKE";
        const bWarn = $("brakingWarning");
        if (bWarn) bWarn.classList.add("visible");
      } else {
        // Full Forward Acceleration (Guarded against negative values into Math.pow)
        const fSpeed = Math.max(0, this.speed);
        const normRatio = Math.max(0, Math.min(1.0, fSpeed / maxForwardSpeed));
        const accel = 26.0 * Math.max(0.22, 1.0 - Math.pow(normRatio, 1.15));
        this.speed = Math.min(maxForwardSpeed, fSpeed + accel * dt);
        this.throttleLevel = 1.0;
        this.brakeLevel = 0.0;
        this.aiState = "MANUAL: FORWARD";
        const bWarn = $("brakingWarning");
        if (bWarn) bWarn.classList.remove("visible");
      }
    } else if (isS) {
      if (this.speed > 0.8) {
        // Hard forward braking
        this.speed = Math.max(0, this.speed - 48.0 * dt);
        this.brakeLevel = 1.0;
        this.throttleLevel = 0.0;
        this.aiState = "MANUAL: BRAKE";
        const bWarn = $("brakingWarning");
        if (bWarn) bWarn.classList.add("visible");
      } else {
        // REVERSE
        const revSpeed = Math.min(0, this.speed);
        this.speed = Math.max(maxReverseSpeed, revSpeed - 16.0 * dt);
        this.throttleLevel = 0.8;
        this.brakeLevel = 0.0;
        this.aiState = "MANUAL: REVERSE";
        const bWarn = $("brakingWarning");
        if (bWarn) bWarn.classList.remove("visible");
      }
    } else {
      // Natural rolling & aero coasting deceleration
      if (this.speed > 0) this.speed = Math.max(0, this.speed - 8.5 * dt);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + 8.5 * dt);
      this.throttleLevel = 0.0;
      this.brakeLevel = 0.0;
      this.aiState = "MANUAL: COAST";
      const bWarn = $("brakingWarning");
      if (bWarn) bWarn.classList.remove("visible");
    }

    if (isNaN(this.speed)) this.speed = 0;

    this.maxSessionSpeed = Math.max(this.maxSessionSpeed || 0, Math.abs(this.speed));

    // 3. Move car in 3D world space along heading
    const vx = Math.sin(this.manualHeading) * this.speed;
    const vz = Math.cos(this.manualHeading) * this.speed;
    this.car.carGroup.position.x += vx * dt;
    this.car.carGroup.position.z += vz * dt;
    this.car.carGroup.position.y = 0.05;

    // 4. Update track progress & lap timing from closest track sample
    const prevProgress = this.progress;
    this.progress = this.track.getNearestProgress(this.car.carGroup.position, prevProgress);
    this.lapTime += dt;

    // Beta: Curb and Off-Track Boundaries Detection
    this.track.curve.getPointAt(this.progress, _pCurr);
    this.track.curve.getTangentAt(this.progress, _scratchTangent);
    _scratchNormal.set(-_scratchTangent.z, 0, _scratchTangent.x).normalize();
    const distToCenter = Math.abs(_vA.subVectors(this.car.carGroup.position, _pCurr).dot(_scratchNormal));
    this.car.carGroup.rotation.z = 0;
    const roadHalf = this.track.roadWidth * 0.5;

    if (distToCenter > (roadHalf - 0.7) && distToCenter < (roadHalf + 0.85)) {
      this.isOverCurb = true;
      this.car.carGroup.position.y = 0.05 + Math.sin(performance.now() * 0.065) * 0.035;
      this.car.carGroup.rotation.z = Math.sin(performance.now() * 0.065) * 0.008;
    } else if (distToCenter >= (roadHalf + 0.85)) {
      this.lapClean = false;
      this.isOverCurb = false;
      this.speed = Math.sign(this.speed) * Math.max(0, Math.abs(this.speed) - 34.0 * dt);
      if (this.tireSmokeSystem && Math.abs(this.speed) > 4) {
        this.tireSmokeSystem.emitSmoke(this.car.carGroup.position, new THREE.Vector3(0, 0, 0), 1.6);
      }
    } else {
      this.isOverCurb = false;
    }

    // Lateral G estimation
    const yawRate = Math.abs(this.steerAngle) > 0.02 ? this.steerAngle * turnRate * steerDir : 0;
    this.lateralG = this.speed * yawRate / G_ACCEL;
    this.maxSessionG = Math.max(this.maxSessionG || 0, Math.abs(this.lateralG));

    // Lap crossing detection (crossing start/finish line in forward direction)
    let advance = this.progress - prevProgress;
    if (advance > 0.5) advance -= 1;
    if (advance < -0.5) advance += 1;
    this.manualLapDistance = Math.max(0, (this.manualLapDistance || 0) + advance);
    if (prevProgress > 0.82 && this.progress < 0.18 && this.speed > 0 && this.manualLapDistance > 0.95) {
      this.manualLapDistance = 0;
      this.completeLap();
    }
  }

  stepPhysics(dt) {
    const trackLength = this.track.totalLength || (520 * this.track.lengthScale);

    const maxStraightSpeed = 228 * MPH_TO_MS;
    const preview = this.progress + (8 + this.speed * 0.45) / trackLength;
    this.targetSpeed = this.driverAI.getPlannedSpeed(preview, this.track);
    const error = this.targetSpeed - this.speed;
    let targetAccel;
    if (error < -0.3) {
      targetAccel = Math.max(-42, error * 4);
      this.brakeLevel = Math.min(1, -targetAccel / 42);
      this.throttleLevel = 0;
      this.aiState = "THRESHOLD BRAKING";
    } else {
      targetAccel = Math.min(26 * Math.max(0.22, 1 - (this.speed / maxStraightSpeed) ** 1.15), Math.max(0, error * 3));
      this.brakeLevel = 0;
      this.throttleLevel = Math.min(1, targetAccel / 12);
      this.aiState = error > 2 ? "FULL THROTTLE STRAIGHT" : "APEX SPEED SETTLE";
    }
    $("brakingWarning")?.classList.toggle("visible", this.brakeLevel > 0.05);
    this.currentAccel += THREE.MathUtils.clamp(targetAccel - this.currentAccel, -110 * dt, 110 * dt);
    // This kinematic driver stays on the spline. Enforce its planned grip limit
    // instead of allowing impossible cornering loads without any tire slip.
    const nextProgress = this.progress + (Math.max(0, this.speed) * dt) / trackLength;
    const localLimit = Math.min(this.driverAI.getPlannedSpeed(this.progress, this.track), this.driverAI.getPlannedSpeed(nextProgress, this.track));
    this.speed = Math.max(0, Math.min(localLimit, this.speed + this.currentAccel * dt));
    const pathOffset = this.track.getLapOffset(this.progress);
    this.isOverCurb = Math.abs(pathOffset) > this.track.roadWidth * 0.5 - 1.1;
    this.lateralG = this.speed ** 2 * this.track.getPathCurvature(this.progress) / G_ACCEL;
    this.maxSessionSpeed = Math.max(this.maxSessionSpeed || 0, this.speed);
    this.maxSessionG = Math.max(this.maxSessionG || 0, Math.abs(this.lateralG));

    // 7. Steering Model (Autonomous AI)
    const lookaheadDs = 7 / trackLength;
    const hCurr = this.track.getTrajectoryHeading(this.progress);
    const hAhead = this.track.getTrajectoryHeading(this.progress + lookaheadDs);
    let dHeading = hAhead - hCurr;
    while (dHeading > Math.PI) dHeading -= Math.PI * 2;
    while (dHeading < -Math.PI) dHeading += Math.PI * 2;

    const lookaheadDist = Math.max(1.0, lookaheadDs * trackLength);
    const pathCurvature = dHeading / lookaheadDist;
    const wheelbase = 3.6; // F1 wheelbase in meters
    const desiredSteer = THREE.MathUtils.clamp(Math.atan2(wheelbase * pathCurvature, 1.0), -0.38, 0.38);
    const steerRate = 1.0 - Math.exp(-7.0 * dt);
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, desiredSteer, steerRate);

    // Track progression
    const deltaProgress = (this.speed * dt) / trackLength;
    this.progress += deltaProgress;
    this.lapTime += dt;

    if (this.progress >= 1.0) {
      this.completeLap();
    }
  }

  completeLap() {
    if (this.state !== "RUNNING") return;
    // Vigorously wave the left-side finish line flag at the end of every lap!
    this.flagCelebrationTimer = 8.0;

    const record = this.driverAI.evaluateLap(this.lapTime);
    record.clean = this.lapClean !== false;
    this.lapClean = true;
    this.records.push(record);

    if (record.isPB) {
      this.fastestRecord = record;
    }

    if (this.currentLap >= this.totalLaps) {
      this.state = "CELEBRATION";
      this.aiState = "VICTORY! LAP COMPLETE 🏁";
      setElText("simStateText", "FINISHED 🏁");
      this.progress = ((this.progress % 1) + 1) % 1;
      this.speed = 0;
      this.currentAccel = 0;
      this.throttleLevel = this.brakeLevel = 0;
      this.finishDelay = 4.5;
    } else {
      this.currentLap += 1;
      this.progress = ((this.progress % 1) + 1) % 1;
      this.lapTime = 0;
      this.driverAI.startLap(this.currentLap, this.track);
    }

    this.updateHUD();
  }

  updateHUD() {
    const speedMph = Math.round(this.speed * MS_TO_MPH);
    const speedKmh = Math.round(this.speed * 3.6);

    // Keep the transmission readout at the paused value until the race resumes.
    if (this.resumeState === null) {
      const trans = computeF1Transmission(speedMph);
      this.currentGear = trans.gear;
      this.currentRPM = THREE.MathUtils.lerp(this.currentRPM || 4500, trans.rpm, 0.22);
    }

    // Standard sidebar HUD
    const spdEl = $("speedDisplay");
    if (spdEl) spdEl.textContent = speedMph;
    const trackLenEl = $("trackLengthDisplay");
    if (trackLenEl && this.track) {
      trackLenEl.textContent = `${Math.round(this.track.totalLength || 5000).toLocaleString()} m`;
    }
    const latEl = $("lateralGDisplay");
    if (latEl) latEl.textContent = `${this.lateralG.toFixed(2)} G`;
    const tgtEl = $("targetSpeedDisplay");
    if (tgtEl) tgtEl.textContent = `${Math.round(this.targetSpeed * MS_TO_MPH)} mph`;
    const lapEl = $("lapTimeDisplay");
    if (lapEl) lapEl.textContent = `${this.lapTime.toFixed(2)} s`;
    const cntEl = $("lapCountDisplay");
    if (cntEl) cntEl.textContent = `Lap ${Math.min(this.currentLap, this.totalLaps)} of ${this.totalLaps}`;
    const aiEl = $("aiStateDisplay");
    if (aiEl) aiEl.textContent = this.aiState;

    // Update 3D In-Car Fixed Steering Wheel Dashboard (Unconditionally active)
    let delta = 0;
    if (this.driverAI.bestLapTime !== Infinity && this.progress > 0.03 && this.state === "RUNNING") {
      const expectedTimeAtProgress = this.driverAI.bestLapTime * this.progress;
      delta = this.lapTime - expectedTimeAtProgress;
    }

    if (this.car) {
      this.car.updateDashboard(
        speedMph,
        speedKmh,
        this.currentRPM,
        this.currentGear,
        this.throttleLevel,
        this.brakeLevel,
        delta,
        this.currentLap,
        this.totalLaps,
        this.lateralG
      );
    }



    // Vehicle Telemetry Meters (Essentials Only)
    const brakeMeter = $("brakeMeter");
    if (brakeMeter) brakeMeter.style.width = `${Math.round(this.brakeLevel * 100)}%`;
    const apexMeter = $("apexMeter");
    if (apexMeter) apexMeter.style.width = `${Math.min(100, Math.round((Math.abs(this.lateralG) / (this.tireGrip * 3.8)) * 100))}%`;
    const throttleMeter = $("throttleMeter");
    if (throttleMeter) throttleMeter.style.width = `${Math.round(this.throttleLevel * 100)}%`;

    if (this.fastestRecord) {
      setElText("fastestLapTag", `Best: ${this.fastestRecord.time.toFixed(2)}s (Lap ${this.fastestRecord.lap})`);
    } else {
      setElText("fastestLapTag", "Best: --");
    }

    // Live Delta Indicator
    const deltaVal = $("liveDeltaVal");
    if (deltaVal) {
      if (this.driverAI.bestLapTime !== Infinity && this.progress > 0.03 && this.state === "RUNNING") {
        const expectedTimeAtProgress = this.driverAI.bestLapTime * this.progress;
        const liveDelta = this.lapTime - expectedTimeAtProgress;
        const sign = liveDelta <= 0 ? "-" : "+";
        const deltaText = `${sign}${Math.abs(liveDelta).toFixed(2)}s`;
        deltaVal.textContent = deltaText;
        deltaVal.className = liveDelta <= 0 ? "delta-val green" : "delta-val red";
      } else if (this.state === "COMPLETE") {
        const resText = this.fastestRecord ? this.fastestRecord.time.toFixed(2) + "s" : "--";
        deltaVal.textContent = `OPTIMIZED: ${resText}`;
        deltaVal.className = "delta-val green";
      } else {
        deltaVal.textContent = "PROBING";
        deltaVal.className = "delta-val";
      }
    }

    const tbody = $("lapTableBody");
    if (tbody) {
      if (this.records.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Awaiting first flying lap...</td></tr>`;
      } else {
        tbody.innerHTML = this.records
          .map(
            (r) => `
          <tr class="${r.isPB ? "fastest-row" : ""}">
            <td>Lap ${r.lap}${r.isPB ? ' <span class="pb-flag">&#9733;</span>' : ""}</td>
            <td><strong>${r.time.toFixed(2)}s</strong></td>
            <td class="${r.lap === 1 ? "" : r.delta <= 0 ? "cyan" : "amber"}">
              ${r.lap === 1 ? "Baseline" : (r.delta <= 0 ? "-" : "+") + Math.abs(r.delta).toFixed(2) + "s"}
            </td>
          </tr>
        `
          )
          .join("");
      }
    }
  }

  updateFPS() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 250) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      const fpsEl = $("fpsDisplay");
      if (fpsEl) fpsEl.textContent = `${fps} FPS`;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
  }

  startAnimationLoop() {
    let previousFrame;
    const renderFrame = (now) => {
      const dt = previousFrame === undefined ? 0 : Math.min((now - previousFrame) / 1000, 0.25);
      previousFrame = now;
      this.rafId = requestAnimationFrame(renderFrame);
      this.stepFrame(dt);
    };
    this.rafId = requestAnimationFrame(renderFrame);
  }

  animate() {
    this.stepFrame(1 / 90);
  }

  updateChasePose(frozen) {
    const car = this.car.carGroup;
    if (frozen && this.previousRaceProgress !== null) return;
    this.chasePosition.copy(car.position);
    this.chaseYaw = car.rotation.y;
    if (this.state !== "RUNNING" || this.previousRaceProgress === null) return;

    // Draw between the last two fixed physics poses. Keep race state on the fixed clock.
    const fraction = this.physicsAccumulator / PHYSICS_STEP;
    if (this.driverMode === "manual") {
      this.chasePosition.lerpVectors(this.previousRacePosition, car.position, fraction);
      this.chaseYaw = THREE.MathUtils.lerp(this.previousRaceYaw, car.rotation.y, fraction);
    } else {
      const advance = (this.progress - this.previousRaceProgress + 1) % 1;
      this.track.getPathPosition(this.previousRaceProgress + advance * fraction, this.chasePosition);
    }
  }

  renderChasePose() {
    const car = this.car.carGroup;
    this.savedCarPosition.copy(car.position);
    const yaw = car.rotation.y;
    car.position.copy(this.chasePosition);
    car.rotation.y = this.chaseYaw;
    try {
      this.renderer.render(this.scene, this.camera);
    } finally {
      car.position.copy(this.savedCarPosition);
      car.rotation.y = yaw;
    }
  }

  stepFrame(dt) {
    const frozen = this.state === "PAUSED" || this.state === "RESUMING";
    if (!frozen) {
      this.updatePhysics(dt);
      this.updateStartCountdown(dt);
      if (this.state === "CELEBRATION") {
        this.finishDelay -= dt;
        if (this.finishDelay <= 0) {
          this.state = "COMPLETE";
          this.updatePauseControl();
          this.showFinishScreen();
        }
      }
    }
    const motionDt = this.state === "RUNNING" ? dt * this.timeScale : 0;

    // 3. Update the finish flag and crowd on the session clock.
    const sceneDt = frozen ? 0 : dt;
    if (this.flagCelebrationTimer > 0) {
      this.flagCelebrationTimer -= sceneDt;
    }
    if (sceneDt > 0) {
      this.track.updateFinishFlag(sceneDt, this.progress, this.flagCelebrationTimer > 0);
    }

    // 4. In Autonomous AI mode, car position and heading follow the racing spline
    if (!frozen && this.driverMode !== "manual") {
      this.track.getPathPosition(this.progress, this.car.carGroup.position);

      const targetHeading = this.track.getTrajectoryHeading(this.progress);
      if (this.state === "READY") {
        this.car.carGroup.rotation.y = targetHeading;
      } else {
        let dRot = targetHeading - this.car.carGroup.rotation.y;
        while (dRot > Math.PI) dRot -= Math.PI * 2;
        while (dRot < -Math.PI) dRot += Math.PI * 2;
        // Realistic chassis yaw rotational inertia
        const blend = 1.0 - Math.exp(-8.5 * dt);
        this.car.carGroup.rotation.y += dRot * THREE.MathUtils.clamp(blend, 0, 1);
      }
    }

    // 4. Update Car Wheel and Chassis Visuals
    const isBraking = this.brakeLevel > 0.05;
    this.car.updateVisuals(this.speed, this.steerAngle, isBraking, motionDt);

    // 5. Update Braking Zone Overlay
    const showBrakingZone = this.cameraManager.mode !== "orbit";
    this.track.brakingZoneMesh.visible = showBrakingZone;
    if (showBrakingZone) this.track.updateBrakingZone(this.progress);

    // 6. Update Handle Scales
    this.track.updateHandleScales(this.camera);

    // 7. Update Camera (Chase camera locks directly behind car's actual forward chassis heading)
    const isChase = this.cameraManager.mode === "chase";
    let carPosition = this.car.carGroup.position;
    this.car.carGroup.getWorldDirection(_camForwardVec);
    if (isChase) {
      this.updateChasePose(frozen);
      carPosition = this.chasePosition;
      if (this.driverMode === "manual") _camForwardVec.set(Math.sin(this.chaseYaw), 0, Math.cos(this.chaseYaw));
    }
    const cameraDt = isChase && frozen ? 0 : dt;
    this.cameraManager.update(this.car.carGroup, _camForwardVec, this.speed, cameraDt, this.track.editHandlesVisible, carPosition);
    if (sceneDt > 0) this.track.crowd.update(sceneDt, this.camera.position);
    // An overview can be several kilometers high; driving-distance haze would
    // obscure the entire circuit even though it is correctly inside the frame.
    const overhead = this.cameraManager.mode === "orbit" && this.cameraManager.orbitPhi > 1.3;
    this.scene.fog.density = overhead ? 0 : this.cameraManager.isTrackOrbit
      ? Math.min(0.00018, 0.25 / this.cameraManager.orbitDistance) : 0.00018;
    this.trackOverview.draw(this.track, this.cameraManager);

    // Move the shadow map with the car in whole light-space texels.
    if (this.cameraManager.mode !== "map") {
      const { camera, mapSize } = this.sun.shadow;
      const texel = (camera.right - camera.left) / mapSize.x;
      const target = this.sun.target.position.copy(carPosition).setY(0);
      const across = target.dot(this.shadowRight);
      const up = target.dot(this.shadowUp);
      target.addScaledVector(this.shadowRight, Math.round(across / texel) * texel - across);
      target.addScaledVector(this.shadowUp, Math.round(up / texel) * texel - up);
    } else {
      this.sun.target.position.set(0, 0, 0);
    }
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);

    // Driver helmet & Halo central pillar visibility: hide in Cockpit 3D POV so track and road ahead are completely unobstructed
    const isCockpit = (this.cameraManager.mode === "hood");
    if (this.car.helmetMesh) {
      this.car.helmetMesh.visible = !isCockpit;
      this.car.visorMesh.visible = !isCockpit;
    }
    if (this.car.haloStrut) {
      this.car.haloStrut.visible = !isCockpit;
    }

    if (this.tireSmokeSystem) {
      this.tireSmokeSystem.update(motionDt, this.camera);
    }

    // Dynamic Tire Smoke & Skidmarks under heavy braking / slip
    const isSlipping = (isBraking && Math.abs(this.speed) > 6.0) || (Math.abs(this.lateralG) > 2.2 && Math.abs(this.speed) > 16.0);
    if (motionDt > 0 && isSlipping && this.tireSmokeSystem && this.tireSmokeSystem.enabled) {
      const carPos = this.car.carGroup.position;
      const carRot = this.car.carGroup.rotation.y;
      const cosR = Math.cos(carRot);
      const sinR = Math.sin(carRot);
      const rlX = carPos.x - cosR * 1.18 - sinR * 1.45;
      const rlZ = carPos.z + sinR * 1.18 - cosR * 1.45;
      const rrX = carPos.x + cosR * 1.18 - sinR * 1.45;
      const rrZ = carPos.z - sinR * 1.18 - cosR * 1.45;

      const pLeft = new THREE.Vector3(rlX, 0.05, rlZ);
      const pRight = new THREE.Vector3(rrX, 0.05, rrZ);
      const fwdVel = new THREE.Vector3(-sinR * this.speed * 0.15, 0, -cosR * this.speed * 0.15);

      this.tireSmokeSystem.emitSmoke(pLeft, fwdVel, 1.0);
      this.tireSmokeSystem.emitSmoke(pRight, fwdVel, 1.0);

      if (this.prevSkidLeft && this.prevSkidRight) {
        this.tireSmokeSystem.addSkidmarkSegment(this.prevSkidLeft, pLeft);
        this.tireSmokeSystem.addSkidmarkSegment(this.prevSkidRight, pRight);
      }
      this.prevSkidLeft = pLeft;
      this.prevSkidRight = pRight;
    } else {
      this.prevSkidLeft = null;
      this.prevSkidRight = null;
    }

    if (this.audio.ctx && this.audio.enabled) {
      this.audio.masterGain.gain.setTargetAtTime(frozen ? 0 : 0.08, this.audio.ctx.currentTime, 0.05);
    }
    // 8. Update Audio Synthesizer (in sync with live RPM, Gear and Curb Vibration)
    if (this.audio) {
      const speedMph = this.speed * MS_TO_MPH;
      this.audio.update(speedMph, isBraking, this.throttleLevel, this.currentRPM, this.currentGear, this.isOverCurb);
    }

    if (this.telemetryGraph) {
      if (motionDt > 0) this.telemetryGraph.record(
        Math.abs(this.speed) / 98.0,
        this.throttleLevel,
        this.brakeLevel,
        this.lateralG / 5.0
      );
      this.telemetryGraph.draw();
    }

    // 9. Update HUD Telemetry & In-Car 3D Dashboard (Every single frame unconditionally)
    this.updateHUD();

    // 10. Update FPS Counter
    this.updateFPS();

    // 11. Render 3D Scene
    if (isChase) this.renderChasePose();
    else this.renderer.render(this.scene, this.camera);
    // Unfreeze after rendering so the last countdown frame consumes no race time.
    this.updateResumeCountdown(dt);
  }
}

function launchApp() {
  try {
    console.log("Mounting Racing Genesis Assignment 3 MVP Simulator (Windows 11 Edition)...");
    window.racingApp = new RacingGenesisApp();
    console.log("Assignment 3 MVP Simulator mounted successfully!");
  } catch (err) {
    console.error("Critical error starting Assignment 3 simulator:", err);
    const banner = document.getElementById("aiStateDisplay");
    if (banner) banner.textContent = "ERROR: " + err.message;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", launchApp);
} else {
  launchApp();
}
