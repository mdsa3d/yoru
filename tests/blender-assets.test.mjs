import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.readUInt32LE(0);
  assert.equal(magic, 0x46546c67, 'Valid glTF binary magic');
  const version = buf.readUInt32LE(4);
  assert.equal(version, 2, 'glTF version 2');
  const jsonLength = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  assert.equal(jsonType, 0x4e4f534a, 'JSON chunk type');
  const jsonStr = buf.toString('utf8', 20, 20 + jsonLength);
  return JSON.parse(jsonStr);
}

function totalVertices(gltf) {
  let count = 0;
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx !== undefined && gltf.accessors?.[posIdx]) {
        count += gltf.accessors[posIdx].count;
      }
    }
  }
  return count;
}

test('motorcycle asset: kestrel.glb has high-detail chassis, cockpit, wheels and PBR materials', () => {
  const p = path.resolve('assets/models/kestrel.glb');
  assert.ok(fs.existsSync(p), 'kestrel.glb exists');
  const gltf = readGLB(p);

  const nodeNames = gltf.nodes.map(n => n.name);
  assert.ok(nodeNames.includes('chassis'), 'has chassis node');
  assert.ok(nodeNames.includes('cockpit'), 'has cockpit node');
  assert.ok(nodeNames.includes('front-wheel'), 'has front-wheel node');
  assert.ok(nodeNames.includes('rear-wheel'), 'has rear-wheel node');

  const frontWheel = gltf.nodes.find(n => n.name === 'front-wheel');
  const rearWheel = gltf.nodes.find(n => n.name === 'rear-wheel');

  // Three.js / glTF coordinates: front is -Z, rear is +Z, up is +Y
  assert.ok(frontWheel.translation[2] < -0.5, 'front wheel is in front (-Z)');
  assert.ok(rearWheel.translation[2] > 0.5, 'rear wheel is in back (+Z)');
  assert.ok(frontWheel.translation[1] > 0.3, 'front wheel is above ground (+Y)');
  assert.ok(rearWheel.translation[1] > 0.3, 'rear wheel is above ground (+Y)');

  const matNames = (gltf.materials || []).map(m => m.name);
  assert.ok(matNames.includes('custom-paint'), 'has custom-paint material');
  assert.ok(matNames.includes('rubber'), 'has rubber material');
  assert.ok(matNames.includes('brake-light'), 'has brake-light material');
  assert.ok(totalVertices(gltf) > 5000, 'kestrel has high-detail geometry (>5000 vertices)');
});

test('challenger assets: redline, ronin, ghost, outlaw, cafe GLB exist with chassis, cockpit and wheels', () => {
  for (const name of ['redline', 'ronin', 'ghost', 'outlaw', 'cafe']) {
    const p = path.resolve(`assets/models/bikes/${name}.glb`);
    assert.ok(fs.existsSync(p), `${name}.glb exists`);
    const gltf = readGLB(p);
    const nodeNames = gltf.nodes.map(n => n.name);
    assert.ok(nodeNames.includes('chassis'), `${name} has chassis`);
    assert.ok(nodeNames.includes('cockpit'), `${name} has cockpit`);
    assert.ok(nodeNames.includes('front-wheel'), `${name} has front-wheel`);
    assert.ok(nodeNames.includes('rear-wheel'), `${name} has rear-wheel`);
    assert.ok(totalVertices(gltf) > 2000, `${name} has high-detail contoured geometry`);
  }
});

test('traffic & aerial assets: sedan, van, taxi and drone GLB exist with wheel/rotor nodes', () => {
  for (const name of ['sedan', 'van', 'taxi']) {
    const p = path.resolve(`assets/models/traffic/${name}.glb`);
    assert.ok(fs.existsSync(p), `${name}.glb exists`);
    const gltf = readGLB(p);
    const nodeNames = gltf.nodes.map(n => n.name);
    assert.ok(nodeNames.includes('body'), `${name} has body node`);
    for (const wn of ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr']) {
      assert.ok(nodeNames.includes(wn), `${name} has ${wn}`);
    }
    assert.ok(gltf.materials && gltf.materials.length >= 5, `${name} has PBR materials`);
    assert.ok(totalVertices(gltf) > 1200, `${name} has contoured geometry`);
  }

  const dp = path.resolve('assets/models/traffic/drone.glb');
  assert.ok(fs.existsSync(dp), 'drone.glb exists');
  const dgltf = readGLB(dp);
  const dNames = dgltf.nodes.map(n => n.name);
  assert.ok(dNames.includes('body'), 'drone has body node');
  for (let i = 0; i < 4; i++) {
    assert.ok(dNames.includes(`rotor-${i}`), `drone has rotor-${i}`);
  }
});

test('world & hazard assets: gantry, tower, barrier, debris, and props GLB exist and are valid', () => {
  for (const name of ['gantry', 'tower', 'barrier', 'debris', 'props']) {
    const p = path.resolve(`assets/models/world/${name}.glb`);
    assert.ok(fs.existsSync(p), `${name}.glb exists`);
    const gltf = readGLB(p);
    assert.ok(gltf.nodes && gltf.nodes.length > 0, `${name} has nodes`);
    assert.ok(gltf.materials && gltf.materials.length >= 3, `${name} has materials`);
  }
  const debrisGltf = readGLB(path.resolve('assets/models/world/debris.glb'));
  const debrisNodes = debrisGltf.nodes.map(n => n.name);
  for (const k of ['debris1', 'debris2', 'debris3']) {
    assert.ok(debrisNodes.includes(k), `debris.glb has ${k}`);
  }
  const propsGltf = readGLB(path.resolve('assets/models/world/props.glb'));
  const propNodes = propsGltf.nodes.map(n => n.name);
  assert.ok(propNodes.includes('streetlamp'), 'props.glb has streetlamp');
  assert.ok(propNodes.includes('pylon'), 'props.glb has pylon');
});

test('human pilot asset: pilot.glb has articulated anatomical nodes and PBR materials', () => {
  const p = path.resolve('assets/models/rider/pilot.glb');
  assert.ok(fs.existsSync(p), 'pilot.glb exists');
  const gltf = readGLB(p);
  const nodeNames = gltf.nodes.map(n => n.name);
  for (const part of ['torso', 'head', 'upper-arm', 'forearm', 'thigh', 'shin', 'elbow-pad', 'knee-pad', 'gauntlet', 'boot']) {
    assert.ok(nodeNames.includes(part), `pilot.glb has ${part} node`);
  }
  const matNames = (gltf.materials || []).map(m => m.name);
  assert.ok(matNames.includes('suit-fabric'), 'has suit-fabric material');
  assert.ok(matNames.includes('armor-plating'), 'has armor-plating material');
  assert.ok(matNames.includes('visor-glow'), 'has visor-glow material');
  assert.ok(totalVertices(gltf) > 1000, 'pilot.glb has sculpted anatomical geometry');
});
