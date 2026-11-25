import './test_browser_env.mjs';
import assert from 'node:assert/strict';
import * as THREE from './three.module.js';
await import('./app.js');
const app = window.racingApp;
assert.ok(app, 'Application must initialize');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const frame = (seconds, fps = 60) => { for (let i = 0; i < Math.ceil(seconds * fps); i++) app.stepFrame(1 / fps); };

check('Countdown starts without an audio exception; explicit audio toggle works', () => {
  app.start(); frame(4.1);
  assert.equal(app.state, 'RUNNING');
  assert.ok(app.speed > 0);
  assert.equal(app.audio.enabled, false);
  document.getElementById('btnAudio').dispatch('click');
  assert.equal(app.audio.enabled, true);
  document.getElementById('btnAudio').dispatch('click');
});
check('Resume counts down 3–2–1 before restoring the live race', () => {
  frame(1);
  const raceState = () => ({
    speed: app.speed, progress: app.progress, lapTime: app.lapTime, lap: app.currentLap,
    acceleration: app.currentAccel, rpm: app.currentRPM, gear: app.currentGear,
    position: app.car.carGroup.position.toArray(), yaw: app.car.carGroup.rotation.y,
    flagWaveTime: app.track.flagWaveTime, head: app.telemetryGraph.head,
  });
  const saved = raceState();
  const countdown = document.getElementById('resumeCountdown');
  const seconds = document.getElementById('resumeSeconds');
  document.getElementById('btnPause').dispatch('click'); frame(1);
  assert.ok(document.getElementById('pauseModal').open);
  assert.deepEqual(raceState(), saved);
  document.getElementById('btnResumeRace').dispatch('click');
  assert.equal(app.state, 'RESUMING');
  assert.equal(countdown.hidden, false);
  assert.equal(seconds.textContent, '3');
  assert.equal(document.getElementById('pauseModal').open, false);
  document.getElementById('btnStart').dispatch('click');
  frame(1);
  assert.equal(seconds.textContent, '2');
  frame(1);
  assert.equal(seconds.textContent, '1');
  assert.deepEqual(raceState(), saved);
  frame(1);
  assert.equal(app.state, 'RUNNING');
  assert.equal(countdown.hidden, true);
  assert.deepEqual(raceState(), saved);
  frame(0.1);
  assert.ok(app.progress > saved.progress);
  assert.ok(app.lapTime > saved.lapTime);
});
check('Countdown can be paused and resumed', () => {
  app.reset();
  document.getElementById('btnPause').dispatch('click');
  assert.equal(app.state, 'READY'); assert.equal(document.getElementById('pauseModal').open, false);
  app.start(); frame(1); window.dispatch('keydown', {code:'Escape', target:{tagName:'INPUT'}}); frame(1);
  const timer = app.countdownTimer;
  assert.equal(app.state, 'PAUSED');
  window.dispatch('keydown', {code:'Escape', repeat:true}); assert.equal(app.state, 'PAUSED');
  window.dispatch('keydown', {code:'Escape'});
  assert.equal(app.state, 'RESUMING');
  frame(3);
  assert.equal(app.state, 'COUNTDOWN'); assert.equal(app.countdownTimer, timer);
});
check('Pausing again and resetting cancel the pending resume', () => {
  app.reset(); app.start(); frame(5);
  const progress = app.progress;
  app.timeScale = 4;
  document.getElementById('btnPause').dispatch('click');
  document.getElementById('btnResumeRace').dispatch('click');
  frame(1);
  assert.equal(app.state, 'RESUMING');
  document.getElementById('btnPause').dispatch('click'); frame(4);
  assert.equal(app.state, 'PAUSED');
  assert.equal(app.progress, progress);
  document.getElementById('btnResumeRace').dispatch('click'); frame(2);
  assert.equal(app.state, 'RESUMING');
  document.getElementById('btnReset').dispatch('click'); frame(4);
  assert.equal(app.state, 'READY');
  assert.equal(document.getElementById('resumeCountdown').hidden, true);
  app.timeScale = 1;
});
check('Dialog controls cannot restart the race from a closed dialog', () => {
  app.reset(); app.start(); frame(5);
  const progress = app.progress;
  const pauseDialog = document.getElementById('pauseModal');
  const finishDialog = document.getElementById('finishModal');
  document.getElementById('btnRestartRace').dispatch('click');
  document.getElementById('btnFinishRestart').dispatch('click');
  assert.equal(app.state, 'RUNNING');
  assert.equal(app.progress, progress);

  window.dispatch('keydown', {key: 'Escape', code: 'Unidentified'});
  assert.equal(pauseDialog.open, true);
  assert.equal(finishDialog.open, false);
  document.getElementById('btnFinishRestart').dispatch('click');
  assert.equal(app.state, 'PAUSED');
  pauseDialog.dispatch('cancel');
  assert.equal(pauseDialog.open, false);
  assert.equal(app.state, 'RESUMING');

  document.hidden = true;
  document.dispatch('visibilitychange');
  document.hidden = false;
  frame(4);
  assert.equal(pauseDialog.open, true);
  assert.equal(app.state, 'PAUSED');
  assert.equal(app.progress, progress);
  pauseDialog.dispatch('cancel');
  frame(3);
  assert.equal(app.state, 'RUNNING');
  assert.equal(app.progress, progress);
});
check('Final lap records once, finishes once, and reset cancels celebration', () => {
  app.reset(); app.totalLaps = 1; app.state = 'RUNNING'; app.progress = 0.99999; app.speed = 60; app.lapTime = 90;
  frame(0.2); assert.equal(app.state, 'CELEBRATION'); assert.equal(app.records.length, 1);
  frame(5); assert.equal(app.state, 'COMPLETE'); assert.equal(app.records.length, 1);
  app.reset(); app.state = 'RUNNING'; app.completeLap(); app.reset(); frame(5);
  assert.equal(app.state, 'READY'); assert.equal(app.records.length, 0);
  assert.equal(document.getElementById('finishModal').open, false);
});
check('FX and driver mode buttons preserve the selected circuit and race', () => {
  app.track.loadF1Preset('spa'); app.state = 'RUNNING'; app.speed = 40;
  const curve = app.track.curve;
  document.getElementById('btnToggleFX').dispatch('click');
  assert.equal(app.track.curve, curve); assert.equal(app.state, 'RUNNING'); assert.equal(app.speed, 40);
  document.getElementById('btnToggleFX').dispatch('click');
  document.querySelectorAll('#panelDriverModeGrid .f1-preset-pill')[1].dispatch('click');
  assert.equal(app.track.curve, curve); assert.equal(app.driverMode, 'manual');
  document.querySelectorAll('#driverModeSwitcher .mode-btn')[0].dispatch('click');
});
check('Manual braking heats rotors and emits smoke', () => {
  app.reset(); app.driverMode = 'manual'; app.state = 'RUNNING'; app.speed = 50; app.keysDown.KeyS = true;
  frame(0.2);
  assert.ok(app.brakeLevel > 0); assert.ok(app.car.brakeHeat > 0);
  assert.ok(app.tireSmokeSystem.particles.some(p => p.active));
});
check('Boundaries use lateral distance, preserve reverse, and reject finish-line oscillation', () => {
  app.reset(); app.driverMode = 'manual'; app.track.roadWidth = 8;
  const p = 20.5 / app.track.sampleCount;
  app.progress = p; app.track.curve.getPointAt(p, app.car.carGroup.position);
  app.stepManualPhysics(1 / 120); assert.equal(app.isOverCurb, false);
  const tangent = app.track.curve.getTangentAt(p);
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  app.track.curve.getPointAt(p, app.car.carGroup.position).addScaledVector(normal, 4);
  app.stepManualPhysics(1 / 120); assert.equal(app.isOverCurb, true);
  app.track.curve.getPointAt(p, app.car.carGroup.position).addScaledVector(normal, 10);
  app.speed = -10; app.stepManualPhysics(1 / 120); assert.ok(app.speed < -9);
  app.reset(); app.state = 'RUNNING'; app.progress = 0.999; app.speed = 1;
  app.track.curve.getPointAt(0.001, app.car.carGroup.position);
  app.stepManualPhysics(1 / 120); assert.equal(app.records.length, 0);
  app.track.roadWidth = 12;
});
check('AI curb offsets and reset state', () => {
  app.reset(); app.driverMode = 'ai'; app.state = 'RUNNING';
  app.track.activePathOffsets.fill(5.5); app.stepPhysics(1 / 120); assert.equal(app.isOverCurb, true);
  app.car.brakeHeat = 1;
  app.reset(); assert.equal(app.car.brakeHeat, 0); assert.equal(app.isOverCurb, false);
  assert.ok(app.tireSmokeSystem.particles.every(p => !p.active));
});
check('Reverse-to-AI mode switch remains finite', () => {
  app.reset(); app.driverMode = 'manual'; app.speed = -10; app.state = 'RUNNING';
  document.querySelectorAll('#driverModeSwitcher .mode-btn')[0].dispatch('click');
  frame(0.2); assert.ok(Number.isFinite(app.speed)); assert.ok(app.speed >= 0);
});
check('Two laps produce two distinct records; off-track status reaches the results', () => {
  app.reset(); app.driverMode = 'ai'; app.totalLaps = 2; app.state = 'RUNNING'; app.lapTime = 80; app.progress = 1;
  app.completeLap(); assert.equal(app.currentLap, 2); assert.equal(app.lapTime, 0);
  app.lapClean = false; app.lapTime = 75; app.progress = 1; app.completeLap(); frame(5);
  assert.equal(app.records.length, 2); assert.equal(app.records[1].lap, 2);
  assert.equal(app.records[1].clean, false);
  assert.ok(document.getElementById('finishTableBody').innerHTML.includes('Off track'));
});
check('Blur clears keys; editing form fields does not trigger driving shortcuts', () => {
  app.reset(); app.driverMode = 'manual';
  window.dispatch('keydown', {code:'KeyW', target:{tagName:'INPUT'}}); assert.equal(app.state, 'READY');
  app.state = 'RUNNING'; app.keysDown.KeyW = true; window.dispatch('blur');
  assert.equal(app.state, 'PAUSED'); assert.deepEqual(app.keysDown, {});
});
check('Fixed-step physics gives the same result at different frame rates and time scales', () => {
  const run = (fps, scale, seconds) => {
    app.reset(); app.driverMode = 'ai'; app.state = 'RUNNING'; app.timeScale = scale;
    for (let i = 0; i < seconds * fps; i++) app.updatePhysics(1 / fps);
    return [app.progress, app.speed];
  };
  const baseline = run(60, 1, 10);
  for (const args of [[30, 1, 10], [144, 1, 10], [60, 10, 1]]) {
    const result = run(...args);
    result.forEach((value, i) => assert.ok(Math.abs(value - baseline[i]) < (i === 1 ? 0.1 : 0.001)));
  }
  app.timeScale = 1;
});

for (const preset of ['workshop', 'monza', 'silverstone', 'spa', 'monaco', 'suzuka']) {
  check(`${preset}: complete AI lap with bounded grip and finite state`, () => {
    app.track.loadF1Preset(preset); app.driverMode = 'ai'; app.totalLaps = 1; app.state = 'RUNNING';
    let brakes = 0;
    for (let i = 0; i < 60000 && app.state === 'RUNNING'; i++) {
      app.updatePhysics(1 / 60);
      assert.ok(Number.isFinite(app.speed) && Number.isFinite(app.progress));
      assert.ok(app.lateralG <= 5.51, `${preset}: ${app.lateralG} G`);
      if (app.brakeLevel > 0.05) brakes++;
    }
    assert.equal(app.records.length, 1);
    assert.ok(brakes > 0, 'must brake for tight corners');
    console.log(`  ${app.records[0].time.toFixed(2)}s, ${app.maxSessionG.toFixed(2)} G, ${brakes} braking frames`);
  });
}
check('Scaled tracks and hairpin stress remain finite at low and high grip', () => {
  for (const [length, grip, stress] of [[1000, 0.55, false], [10000, 1.65, false], [1000, 0.55, true]]) {
    app.track.loadF1Preset('monaco'); app.track.scaleTrackToTargetLength(length);
    if (stress) app.track.setHairpinStress();
    app.tireGrip = grip; app.reset(); app.driverMode = 'ai'; app.totalLaps = 1; app.state = 'RUNNING';
    for (let i = 0; i < 60000 && app.state === 'RUNNING'; i++) {
      app.updatePhysics(1 / 60);
      assert.ok(Number.isFinite(app.speed) && Number.isFinite(app.lateralG));
      assert.ok(app.lateralG <= 5.51, `Stress corner load: ${app.lateralG}`);
    }
    assert.equal(app.records.length, 1);
  }
  app.tireGrip = 1.10;
});
function assertTrackVisible() {
  app.cameraManager.update(app.car.carGroup, new THREE.Vector3(0, 0, 1), 0, 1 / 60);
  app.camera.updateMatrixWorld(true);
  for (const sample of app.track.samples) {
    const p = sample.position.clone().project(app.camera);
    assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1, `Clipped sample: ${p.toArray()}`);
  }
}
check('Third person renders continuous motion and stays clear of the start bridge', () => {
  app.track.loadF1Preset('workshop');
  app.setCamera('chase');
  app.driverMode = 'ai';
  app.state = 'RUNNING';
  const gantry = app.track.trackGroup.getObjectByName('Start / Finish Gantry');
  gantry.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster();
  const previous = new THREE.Vector3();
  const sightline = new THREE.Vector3();
  const car = app.car.carGroup;
  const render = app.renderer.render;
  let sampledFrames = 0;
  let crossed = false;
  try {
    frame(1, 144);
    previous.copy(app.chasePosition);
    app.renderer.render = () => {
      assert.ok(car.position.distanceTo(previous) > 0.001, '3rd Person stalled on a render frame');
      previous.copy(car.position);
      sightline.copy(car.position).setY(0.5).sub(app.camera.position);
      ray.far = sightline.length() - 1;
      ray.set(app.camera.position, sightline.normalize());
      assert.equal(ray.intersectObject(gantry, true).length, 0, 'Bridge blocks the car');
      crossed ||= app.progress > 6 / app.track.totalLength;
      sampledFrames++;
    };
    frame(3, 144);
    assert.ok(crossed && sampledFrames === 432);
    const physicsPosition = app.track.getPathPosition(app.progress, new THREE.Vector3());
    assert.ok(car.position.distanceTo(physicsPosition) < 1e-8);
  } finally {
    app.renderer.render = render;
    app.reset();
  }
});
check('Orbit fits every preset, zooms and rotates around its bounds', () => {
  for (const preset of ['workshop', 'monza', 'silverstone', 'spa', 'monaco', 'suzuka']) {
    app.track.loadF1Preset(preset); app.cameraManager.setMode('orbit');
    for (const phi of [0.2, Math.PI / 4, Math.PI / 2 - 0.001]) {
      app.cameraManager.orbitPhi = phi; app.cameraManager.orbitTheta = 1.2; assertTrackVisible();
    }
  }
  const before = app.cameraManager.orbitDistance;
  app.renderer.domElement.dispatch('wheel', {deltaY: -100}); assert.ok(app.cameraManager.orbitDistance < before);
  app.renderer.domElement.dispatch('dblclick');
  assert.equal(app.cameraManager.orbitDistance, app.cameraManager.orbitFitDistance);
  assert.ok(app.cameraManager.orbitPhi > 1.57);
  assertTrackVisible();
});
check('Orbit refits scaled, translated and edited tracks and portrait windows', () => {
  for (const length of [1000, 10000]) {
    app.track.scaleTrackToTargetLength(length); assertTrackVisible();
  }
  app.track.controlPoints.forEach(p => {p.x += 4000; p.z -= 2000;});
  app.track.rebuildTrackFromPoints(); assertTrackVisible();
  assert.ok(app.cameraManager.orbitTarget.x > 2000);
  const p = app.track.controlPoints[2]; app.track.moveAnchor(2, p.x + 300, p.z + 100); assertTrackVisible();
  window.innerWidth = 600; window.innerHeight = 1000; window.dispatch('resize'); assertTrackVisible();
  window.innerWidth = 1920; window.innerHeight = 1080; window.dispatch('resize');
});
check('Orbit atmosphere stays clear and driving atmosphere is restored', () => {
  app.reset(); app.cameraManager.setMode('orbit'); app.stepFrame(1 / 60);
  assert.ok(app.scene.fog.density * app.cameraManager.orbitDistance <= 0.251);
  app.cameraManager.setMode('chase'); app.stepFrame(1 / 60); assert.equal(app.scene.fog.density, 0.00018);
});
check('The overhead map shows guidance and yields to close views and editing', () => {
  app.track.loadF1Preset('workshop');
  const canvas = document.getElementById('trackOverviewCanvas');
  const legend = document.getElementById('trackOverviewLegend');
  app.cameraManager.orbitPhi = Math.PI / 2 - 0.001;
  document.getElementById('btnAerialMap').dispatch('click');
  app.stepFrame(1 / 60);
  assert.equal(Math.round(app.track.totalLength), 5200);
  assert.deepEqual(new Set(app.track.overviewGuidance), new Set([0, 1, 2]));
  assert.equal(canvas.hidden, false);
  assert.equal(legend.hidden, false);

  app.track.toggleEditHandles();
  app.stepFrame(1 / 60);
  assert.equal(canvas.hidden, true);
  app.track.toggleEditHandles();
  app.cameraManager.orbitDistance *= 0.4;
  app.stepFrame(1 / 60);
  assert.equal(legend.hidden, true);
});
check('Top/Orbit opens a stabilized Helicopter shot with Full circuit and Map available', () => {
  app.track.loadF1Preset('workshop');
  const topButton = document.querySelectorAll('.cam-btn').find(btn => btn.dataset.cam === 'aerial');
  const controls = document.getElementById('aerialControls');
  const map = document.getElementById('trackOverviewCanvas');
  topButton.dispatch('click');
  app.stepFrame(1 / 60);
  assert.equal(app.cameraManager.mode, 'aerial');
  assert.equal(controls.hidden, false);
  assert.equal(map.hidden, true);

  // Check the actual car's projected length and framing as the camera tracks a lap.
  const forward = new THREE.Vector3();
  const car = app.car.carGroup;
  app.cameraManager.cameraInitialized = false;
  const dt = 1 / 60;
  const speed = 90;
  const progressStep = speed * dt / app.track.totalLength;
  for (let progress = 0; progress < 1; progress += progressStep) {
    app.track.getPathPosition(progress, car.position);
    car.rotation.y = app.track.getTrajectoryHeading(progress);
    car.getWorldDirection(forward);
    app.cameraManager.update(car, forward, speed, dt);
    app.camera.updateMatrixWorld(true);
    const center = car.position.clone().project(app.camera);
    const nose = car.position.clone().addScaledVector(forward, 3.2).project(app.camera);
    const tail = car.position.clone().addScaledVector(forward, -2.2).project(app.camera);
    assert.ok(Math.abs(center.x) < 0.5 && Math.abs(center.y) < 0.65);
    assert.ok(Math.hypot(nose.x - tail.x, nose.y - tail.y) > 0.10);
  }
  const distance = app.cameraManager.aerialDistance;
  app.renderer.domElement.dispatch('wheel', {deltaY: -100});
  assert.ok(app.cameraManager.aerialDistance < distance);
  app.renderer.domElement.dispatch('dblclick');
  assert.equal(app.cameraManager.aerialDistance, distance);

  document.getElementById('btnAerialCircuit').dispatch('click');
  assertTrackVisible();
  app.stepFrame(1 / 60);
  assert.equal(map.hidden, true);
  document.getElementById('btnAerialMap').dispatch('click');
  app.stepFrame(1 / 60);
  assert.equal(topButton.classList.contains('active'), true);
  assert.equal(map.hidden, false);
});
check('Full circuit draws one scene with the real car and zooms into a tracking shot', () => {
  const { car, camera, cameraManager, renderer, scene } = app;
  const original = app.renderer;
  const editor = document.getElementById('leftPanel');
  const telemetry = document.getElementById('rightPanel');
  const layout = [editor, telemetry].map(panel => panel.classList.contains('collapsed'));
  const frames = [];
  const stub = {
    ...renderer, isWebGLRenderer: true,
    render(world, view) { frames.push({ world, view, carVisible: car.carGroup.visible }); },
  };
  try {
    app.renderer = stub;
    app.reset();
    document.getElementById('btnAerialCircuit').dispatch('click');
    assertTrackVisible();
    app.stepFrame(1 / 60);
    assert.ok(camera.getWorldDirection(new THREE.Vector3()).y < -0.99999);
    assert.deepEqual(frames, [{ world: scene, view: camera, carVisible: true }]);
    assert.ok(cameraManager.orbitFocus.equals(cameraManager.orbitTarget));
    const circuit = app.track.samples.map(({position}) => position.clone().project(camera));
    const xs = circuit.map(p => p.x), ys = circuit.map(p => p.y);
    assert.ok(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > 1.5);
    assert.ok(editor.classList.contains('collapsed') && telemetry.classList.contains('collapsed'));
    assert.equal(app.scene.fog.density, 0);
    assert.equal(app.track.brakingZoneMesh.visible, false);
    assert.equal(document.getElementById('liveDeltaBadge').hidden, true);

    // Confirm the grid car is visible directly above its nose, clear of the bridge.
    scene.updateMatrixWorld(true);
    const heading = car.carGroup.getWorldDirection(new THREE.Vector3());
    const nose = car.carGroup.position.clone().addScaledVector(heading, 2.25);
    nose.y += 20;
    const ray = new THREE.Raycaster(nose, new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects([car.carGroup, app.track.trackGroup], true);
    assert.equal(hits[0]?.object.name, 'Tapered nose and front monocoque');

    renderer.domElement.dispatch('wheel', {deltaY: -10000});
    const forward = new THREE.Vector3();
    const position = car.carGroup.position;
    const dt = 1 / 60;
    const speed = 90;
    for (let progress = 0; progress < 1; progress += speed * dt / app.track.totalLength) {
      app.track.getPathPosition(progress, position);
      car.carGroup.rotation.y = app.track.getTrajectoryHeading(progress);
      car.carGroup.getWorldDirection(forward);
      cameraManager.update(car.carGroup, forward, speed, dt);
      camera.updateMatrixWorld(true);
      if (progress < 0.015) continue; // Allow the wide shot to settle after zooming.
      const projected = position.clone().project(camera);
      assert.ok(Math.abs(projected.x) < 0.7 && Math.abs(projected.y) < 0.7);
    }
    renderer.domElement.dispatch('dblclick');
    assertTrackVisible();
  } finally {
    app.renderer = original;
    app.setCamera('aerial');
    cameraManager.setTrack(app.track);
  }
  assert.deepEqual([editor, telemetry].map(panel => panel.classList.contains('collapsed')), layout);
  assert.equal(document.getElementById('liveDeltaBadge').hidden, false);
});
check('Full circuit shows zoom help and accepts buttons, wheel, and pinch', () => {
  const view = app.cameraManager;
  const canvas = app.renderer.domElement;
  const controls = document.getElementById('circuitZoomControls');
  const zoomIn = document.getElementById('btnCircuitZoomIn');
  const zoomOut = document.getElementById('btnCircuitZoomOut');
  const fit = document.getElementById('btnCircuitFit');
  assert.equal(controls.hidden, true);
  app.setCamera('orbit');
  try {
    assert.equal(controls.hidden, false);
    assert.ok(canvas.classList.contains('circuit-camera'));
    const wide = view.orbitDistance;
    zoomIn.dispatch('click');
    assert.ok(view.orbitDistance < wide);
    zoomOut.dispatch('click');
    assert.ok(Math.abs(view.orbitDistance - wide) < 1e-8);
    canvas.dispatch('wheel', {deltaY: -10000});
    assert.equal(view.orbitDistance, view.orbitMinDistance);
    assert.equal(zoomIn.disabled, true);
    fit.dispatch('click');
    assert.equal(view.orbitDistance, wide);
    assert.equal(zoomIn.disabled, false);

    const touches = span => ({targetTouches: [{clientX: 0, clientY: 0}, {clientX: span, clientY: 0}]});
    canvas.dispatch('touchstart', {type: 'touchstart', ...touches(100)});
    canvas.dispatch('touchmove', {type: 'touchmove', ...touches(200)});
    assert.equal(view.orbitDistance, wide / 2);
    canvas.dispatch('touchmove', {type: 'touchmove', ...touches(100)});
    assert.equal(view.orbitDistance, wide);
    canvas.dispatch('touchcancel');
    canvas.dispatch('touchmove', {type: 'touchmove', ...touches(200)});
    assert.equal(view.orbitDistance, wide);
  } finally {
    app.setCamera('map');
  }
  assert.equal(controls.hidden, true);
  assert.equal(canvas.classList.contains('circuit-camera'), false);
});
check('Editing does not move the orbit camera until the drag finishes', () => {
  app.cameraManager.setMode('orbit'); app.isDraggingHandle = true;
  const target = app.cameraManager.orbitTarget.clone();
  const p = app.track.controlPoints[0]; app.track.moveAnchor(0, p.x + 1000, p.z);
  assert.ok(app.cameraManager.orbitTarget.equals(target));
  app.renderer.domElement.dispatch('pointerup'); assert.equal(app.isDraggingHandle, false);
  assertTrackVisible();
});
check('Track rebuild disposes nested geometry, materials and textures once', () => {
  const resources = new Set();
  for (const group of [app.track.trackGroup, app.treeGroup, app.mountainGroup]) {
    group.traverse(object => {
      if (object.isInstancedMesh) resources.add(object);
      if (object.geometry) resources.add(object.geometry);
      for (const m of [].concat(object.material || [])) {
        resources.add(m);
        Object.values(m).forEach(v => {if (v?.isTexture) resources.add(v);});
      }
    });
  }
  [app.track.matLightOff, app.track.matLightRed, app.track.matLightGreen].forEach(r => resources.add(r));
  const disposed = new Map();
  resources.forEach(r => r.addEventListener('dispose', () => disposed.set(r, (disposed.get(r) || 0) + 1)));
  app.track.rebuildTrackFromPoints();
  resources.forEach(r => assert.equal(disposed.get(r), 1, r.type));
});
check('Trackside scenery batches crowds and uses one runoff surface', () => {
  app.track.loadF1Preset('workshop');
  const group = app.track.trackGroup;
  let trackMeshes = 0;
  group.traverse(object => { if (object.isMesh) trackMeshes++; });
  assert.ok(trackMeshes < 200, `Track meshes: ${trackMeshes}`);
  const { venues } = app.track.crowd;
  assert.equal(venues.length, 7);
  assert.ok(venues.reduce((sum, venue) => sum + venue.arms.count, 0) > 750);
  const first = venues[0];
  const before = first.arms.instanceMatrix.array.slice(0, 16);
  app.track.crowd.update(0.1, first.group.position);
  assert.notDeepEqual(first.arms.instanceMatrix.array.slice(0, 16), before);
  const rail = group.getObjectByName('Guardrail panels');
  assert.ok(rail.isInstancedMesh && rail.count > 0);
  const runoff = group.getObjectByName('Gravel runoff');
  assert.ok(runoff.geometry.index.count > 0);
});
console.log(`\n${checks} regression checks passed.`);
