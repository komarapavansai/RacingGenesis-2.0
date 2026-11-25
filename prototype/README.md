# Racing Genesis prototype

A static Three.js racing game with editable planar circuits, autonomous and manual driving, synthesized audio, and telemetry. Three.js r186 is bundled locally; no package installation or build step is required.

## Run locally

From the repository root:

```powershell
cd prototype
python serve.py 8081
```

Open http://localhost:8081. The root repository index also redirects to `prototype/index.html` when served from the repository root.

## Controls

| Action | Control |
| --- | --- |
| Accelerate | W / Up arrow |
| Brake, then reverse | S / Down arrow |
| Steer | A / D or Left / Right arrows |
| Cycle Chase, Cockpit, Top/Orbit | C or header buttons |
| Pause / resume | Escape; Pause and Resume buttons |
| Toggle audio | M or Audio button |
| Track Editor / Telemetry drawers | [ / ] |
| Orbit camera | Drag to rotate and tilt; wheel to zoom; double-click the canvas to fit |
| Edit track | Toggle 3D Edit Handles, then drag an anchor |

The default 5.2 km Workshop circuit has a pit straight, hairpins, and esses. Top/Orbit opens in **Helicopter**, a stabilized tracking shot angled down toward the 3D car and the road ahead. **Full circuit** frames the track directly overhead and folds away the side drawers, which can be reopened. Scroll, pinch, or use **+** and **−** to zoom. Select **Fit track** or double-click the canvas to restore the overhead framing. Drag to change the angle. **Map** adds color-coded track guidance. Full circuit and Map refit when the track, drawers, or viewport change. During an anchor drag the camera stays still and refits on release.

Road width, curvature, and surface friction apply with Rebuild Track. Track length commits when the numeric field loses focus or the slider drag finishes. Circuit changes reset the session; FX and driving-mode toggles preserve the circuit.

## Runtime structure

`app.js` contains the application classes; `index.html` supplies the controls and `style.css` supplies the overlay layout.

- `Track3D`: closed centripetal Catmull-Rom spline, sampled planar frames, road/scenery meshes, nearest-segment progress, and editable anchors.
- `HeuristicNPCDriver`: smoothed per-lap path offsets, best-lap records, and a curvature-based speed profile. A backward braking pass plans deceleration before corners.
- `RacingGenesisApp`: input, race states, 120 Hz fixed simulation steps, HUD updates, and rendering.
- `RaceCar3D`: procedural vehicle geometry, wheel animation, brake glow, and a canvas-textured cockpit display.
- `CameraManager3D`: Chase, Cockpit, Helicopter, Full circuit, and Map framing.
- `TireSmokeAndSkidSystem`: 120 pooled smoke instances and 90 skidmark segments.
- `RacingEngineSound`: Web Audio oscillators controlled by RPM, braking, throttle, and curb contact.
- `LiveTelemetryGraph`: a 75-sample rolling history recorded on active rendered frames.

Resume shows a three-second countdown while the race stays frozen. When it ends, the previous phase continues with the same speed, position, and lap time. The final lap is recorded once, motion stops, and a frame-driven 4.5-second celebration precedes results. Reset cancels pending countdowns and clears session effects. Losing window focus pauses and releases held driving keys.

Track, scenery, and handle rebuilds dispose nested geometry, materials, and textures, deduplicating shared resources within each owned group.

## Verification

From either the repository root or the prototype directory:

```powershell
node prototype/test_beta_simulation.mjs
node prototype/scratch_test.mjs
```

When already in `prototype`, omit the `prototype/` prefix.

The regression suite uses real Three.js geometry and math with mocked DOM, Canvas, audio, and animation scheduling. It asserts countdown, pause/resume, completion/reset, independent UI buttons, manual boundaries and reverse, brake effects, mode switching, fixed-step timing, all six preset laps, low/high-grip stress tracks, camera projection after edits/resizing, overview fog, and recursive resource disposal. Failures produce a nonzero exit status. The smoke test asserts that application initialization actually succeeded.

The headless environment deliberately has no WebGL context; renderer-context warnings are expected there. These tests do not measure GPU frame rate, image quality, or audible output. For browser checks, exercise Top/Orbit, change circuits and lengths, drag/zoom/refit, drive through a countdown, pause/resume, toggle FX, and finish a one-lap session.

## Model and performance limits

The AI is a kinematic spline follower with a speed envelope, including a local speed cap to respect planned grip. It does not simulate physical tire slip. Manual driving uses heading and velocity integration with lateral-distance curb/off-track checks; scenery and cars have no rigid-body collision solver.

Per-lap strategies remain predetermined heuristics. Best-lap storage does not train a model or optimize future strategies. Named circuit point sets are approximations, and the track is planar. Brake heat is a normalized visual effect, not a temperature or kinetic-energy calculation. The live delta estimates pace against the best lap.

Rendering follows the display refresh, subject to hardware and scene complexity. Physics runs at fixed 120 Hz simulation steps. Telemetry is sampled per active render frame. Nested-resource disposal is covered by tests. Historical assignment reports describe the submitted beta and contain stronger claims than this implementation supports.
