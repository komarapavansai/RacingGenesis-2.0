import * as THREE from "./three.module.js";

// Share the same geometries and materials across the grandstand and berm batches.
export class TrackCrowd {
  constructor() {
    this.venues = [];
    this.time = 0;
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Euler();
    this.quaternion = new THREE.Quaternion();
    this.scale = new THREE.Vector3(1, 1, 1);
    this.pose = new THREE.Matrix4();
    this.parts = {
      seated: new THREE.BoxGeometry(0.46, 0.65, 0.28).translate(0, 0.325, 0),
      standing: new THREE.BoxGeometry(0.46, 0.78, 0.28).translate(0, 0.39, 0),
      head: new THREE.SphereGeometry(0.18, 10, 10).translate(0, 0.2, 0),
      cap: new THREE.CylinderGeometry(0.19, 0.19, 0.08, 10).translate(0, 0.32, 0),
      arm: new THREE.CylinderGeometry(0.065, 0.065, 0.55, 6).translate(0, 0.28, 0),
      stick: new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4).translate(0.08, 0.55, 0),
      flag: new THREE.PlaneGeometry(0.42, 0.28).translate(0.26, 0.75, 0),
    };
    this.cloth = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    this.skin = new THREE.MeshStandardMaterial({ color: 0xf5cba7, roughness: 0.8 });
    this.pole = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.25 });
    this.flag = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  }

  addVenue(group, people, seated) {
    if (!people.length) return;
    const bodyHeight = seated ? 0.65 : 0.78;
    const flagCount = people.filter(person => person.flag).length;
    const addBatch = (part, material, count = people.length, moving = false) => {
      const mesh = new THREE.InstancedMesh(this.parts[part], material, count);
      mesh.name = `Crowd ${part}`;
      if (moving) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      return mesh;
    };
    const body = addBatch(seated ? "seated" : "standing", this.cloth);
    const head = addBatch("head", this.skin);
    const cap = addBatch("cap", this.cloth);
    const arms = addBatch("arm", this.cloth, people.length, true);
    const sticks = flagCount ? addBatch("stick", this.pole, flagCount, true) : null;
    const flags = flagCount ? addBatch("flag", this.flag, flagCount, true) : null;
    const color = new THREE.Color();
    let flagIndex = 0;
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const { x, y, z, heading, shirt, whiteCap } = person;
      this.rotation.set(0, heading, 0);
      this.quaternion.setFromEuler(this.rotation);
      this.position.set(x, y, z);
      this.pose.compose(this.position, this.quaternion, this.scale);
      body.setMatrixAt(i, this.pose);
      this.position.y += bodyHeight;
      this.pose.setPosition(this.position);
      head.setMatrixAt(i, this.pose);
      cap.setMatrixAt(i, this.pose);
      body.setColorAt(i, color.setHex(shirt));
      arms.setColorAt(i, color);
      cap.setColorAt(i, color.setHex(whiteCap ? 0xffffff : shirt));
      if (person.flag) flags.setColorAt(flagIndex++, color.setHex(shirt));

      // Arm pivot in the venue's local coordinates. Its pose is reused each frame.
      person.armPivot = new THREE.Matrix4().makeRotationY(heading);
      person.armPivot.setPosition(x + Math.cos(heading) * 0.26, y + bodyHeight * 0.85, z - Math.sin(heading) * 0.26);
    }

    const venue = { group, people, arms, sticks, flags };
    this.venues.push(venue);
    this.updateVenue(venue);
    for (const mesh of [arms, sticks, flags]) {
      if (!mesh) continue;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 1; // Include the maximum flag sweep.
    }
  }

  updateVenue({ people, arms, sticks, flags }) {
    let flagIndex = 0;
    for (let i = 0; i < people.length; i++) {
      const { seed, armPivot, flag } = people[i];
      this.rotation.set(Math.sin(this.time * 3.5 + seed * 0.7) * 0.3, 0, -0.6 + Math.sin(this.time * 5 + seed) * 0.5);
      this.pose.makeRotationFromEuler(this.rotation).premultiply(armPivot);
      arms.setMatrixAt(i, this.pose);
      if (flag) {
        sticks.setMatrixAt(flagIndex, this.pose);
        flags.setMatrixAt(flagIndex++, this.pose);
      }
    }
    arms.instanceMatrix.needsUpdate = true;
    if (flags) {
      sticks.instanceMatrix.needsUpdate = true;
      flags.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt, cameraPosition) {
    this.time += dt;
    for (const venue of this.venues) {
      if (venue.group.position.distanceToSquared(cameraPosition) < 160 ** 2) this.updateVenue(venue);
    }
  }
}
