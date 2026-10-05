import test from 'node:test';import assert from 'node:assert/strict';
import * as T from 'three';
import {MenuBackdrop} from '../src/menu-backdrop.js';

test('MenuBackdrop constructs, updates and disposes without a browser context',()=>{
 const scene=new T.Scene();
 const camera=new T.PerspectiveCamera(48,16/9,.1,100);
 scene.add(camera);
 const bd=new MenuBackdrop(scene,camera);
 assert.ok(bd);
 assert.equal(camera.children.includes(bd.root),true);
 bd.setWorld({skyTop:'#071225',accent:'#63f2eb',secondary:'#ff6592',fog:'#203847'});
 bd.quality='high';
 bd.update(0.016,1.0,true);
 bd.setVisible(true);
 assert.equal(bd.root.visible,true);
 assert.equal(bd.particles.visible,true);
 bd.setVisible(false);
 assert.equal(bd.root.visible,false);
 assert.equal(bd.particles.visible,false);
 bd.dispose();
});

test('MenuBackdrop respects low quality and disabled effects',()=>{
 const scene=new T.Scene();
 const camera=new T.PerspectiveCamera(48,16/9,.1,100);
 const bd=new MenuBackdrop(scene,camera);
 bd.setWorld({skyTop:'#111c3c',accent:'#79ffdf',secondary:'#ad9eff',fog:'#869fac'});
 bd.quality='low';
 bd.update(0.016,1.0,true);
 assert.equal(bd.gradientMaterial.uniforms.uNoiseOctaves.value,0);
 assert.equal(bd.gridMaterial.uniforms.uShowGrid.value,0);
 assert.equal(bd.particleMaterial.uniforms.uShowParticles.value,0);
 bd.quality='auto';
 bd.update(0.016,1.0,false);
 assert.equal(bd.gradientMaterial.uniforms.uNoiseOctaves.value,1);
 assert.equal(bd.particleMaterial.uniforms.uShowParticles.value,0);
 bd.dispose();
});

test('MenuBackdrop lerps world colors toward target',()=>{
 const scene=new T.Scene();
 const camera=new T.PerspectiveCamera(48,16/9,.1,100);
 const bd=new MenuBackdrop(scene,camera);
 bd.setWorld({skyTop:'#ffffff',accent:'#ffffff',secondary:'#ffffff',fog:'#ffffff'});
 bd.gradientMaterial.uniforms.uSkyTop.value.set('#000000');
 bd.update(0.016,1.0,true);
 const r=bd.gradientMaterial.uniforms.uSkyTop.value.r;
 assert.ok(r>0&&r<1,'skyTop should be mid-lerp');
 bd.dispose();
});
