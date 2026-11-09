export const WORLD_GRAPHICS_VERSION = 4;
import * as T from 'three';
import {Sky} from '../vendor/three-addons/Sky.js';
import {Water} from '../vendor/three-addons/Water.js';
import {createTuftGeometry} from '../vendor/mrdoob-moss/botany.js';
import {createFoodCartParts} from '../vendor/slop-newyork/street-props.js';
import {routeX} from './routes.js';

// Physical daylight, also captured into the PBR environment for metal and foliage.
export function addDaylight(w){
 const sky=new Sky();sky.scale.setScalar(4500);sky.frustumCulled=false;
 const u=sky.material.uniforms;u.turbidity.value=3.2;u.rayleigh.value=1.35;
 u.mieCoefficient.value=.004;u.mieDirectionalG.value=.82;
 const sun=new T.Vector3(-.45,.66,-.6).normalize();u.sunPosition.value.copy(sun);
 w.scene.add(sky);w.resources.add(sky.geometry);w.resources.add(sky.material);
 const environmentScene=new T.Scene();const environmentSky=sky.clone();environmentScene.add(environmentSky);
 const pmrem=new T.PMREMGenerator(w.renderer);
 const target=pmrem.fromScene(environmentScene,.04,.1,10000);pmrem.dispose();
 w.resources.add(target);w.scene.environment=target.texture;w.scene.environmentIntensity=.28;
 return {sky,sun};
}

export function addReflectingLake(w,sun){
 // Tileable analytic normal texture: generated locally, no remote image dependency.
 const size=128,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const a=x/size*Math.PI*2,b=y/size*Math.PI*2;
  const dx=.28*Math.cos(a*7+b*3)+.18*Math.cos(a*13-b*9)+.1*Math.sin(a*29+b*11);
  const dy=.25*Math.cos(a*7+b*3)-.22*Math.cos(a*13-b*9)+.13*Math.sin(a*17-b*19);
  const n=new T.Vector3(dx,dy,1).normalize(),i=(y*size+x)*4;
  data[i]=(n.x*.5+.5)*255;data[i+1]=(n.y*.5+.5)*255;data[i+2]=(n.z*.5+.5)*255;data[i+3]=255;
 }
 const normal=new T.DataTexture(data,size,size);normal.wrapS=normal.wrapT=T.RepeatWrapping;
 normal.magFilter=T.LinearFilter;normal.minFilter=T.LinearMipmapLinearFilter;normal.generateMipmaps=true;normal.needsUpdate=true;w.resources.add(normal);
 const geometry=new T.PlaneGeometry(180,w.length+260);
 const water=new Water(geometry,{textureWidth:w.quality==='low'?256:512,textureHeight:w.quality==='low'?256:512,waterNormals:normal,sunDirection:sun,sunColor:0xffedc9,waterColor:0x174b47,distortionScale:1.4,fog:true});
 water.rotation.x=-Math.PI/2;water.position.set(94,-.045,-w.length/2);water.material.uniforms.size.value=1.8;
 w.scene.add(water);w.resources.add(water);w.resources.add(geometry);w.resources.add(water.material);
 // Mirror render cost is bounded; camera movement still refreshes the reflection.
 const reflect=water.onBeforeRender;let frame=0;
 water.onBeforeRender=function(...args){if(frame++%(w.quality==='low'?4:2)===0)reflect.apply(this,args);};
 // Far-bank landforms provide a silhouette and something meaningful to reflect.
 const banks=[];for(let i=0;i<18;i++)banks.push({x:70+w.rng()*20,y:-2,z:45-i*24,sx:18+w.rng()*18,sy:7+w.rng()*16,sz:24,ry:w.rng()*6,color:['#667b69','#7b8d76','#526c60'][i%3]});
 w.batch(new T.IcosahedronGeometry(1,3),w.mat('#ffffff',{vertexColors:false,roughness:1}),banks,false);
 return water.material;
}

// Adapted mrdoob Codevember 05 geometry: solid leaves, not image cards.
export function addMossBanks(w,height){
 const geometry=createTuftGeometry(20261105,3);geometry.setAttribute('color',geometry.getAttribute('pigment'));
 const plant=geometry.getAttribute('plant'),color=geometry.getAttribute('color');
 for(let i=0;i<color.count;i++){const ao=.48+.52*plant.getZ(i);color.setXYZ(i,color.getX(i)*ao,color.getY(i)*ao,color.getZ(i)*ao);}
 const material=w.mat('#c4d795',{vertexColors:true,roughness:.83});const chunks=[];
 for(let cell=-1;cell<Math.ceil(w.length/12)+1;cell++){
  const positions=[];
  for(let i=0;i<(w.quality==='low'?24:65);i++){
   const d=cell*12+w.rng()*12,side=i%2?1:-1,edge=1.15+w.rng()*2.4;
   const x=routeX(d,'forest')+side*edge,z=-d;
   if(Math.sin(d*.48+edge*2)<-.3)continue;
   const s=1.6+w.rng()*1.9;positions.push({x,y:height(x,z)+.008,z,sx:s,sy:s,sz:s,ry:w.rng()*Math.PI*2});
  }
  const mesh=w.batch(geometry,material,positions,false);if(mesh)chunks.push({mesh,d:cell*12+6});
 }
 return d=>chunks.forEach(c=>c.mesh.visible=Math.abs(c.d-d)<(w.quality==='low'?18:26));
}

export function addStreetDetails(w){
 const placements=[];for(let d=8;d<w.length;d+=48)placements.push({x:routeX(d,'city')+(d%96<48?4.7:-4.7),y:.03,z:-d,ry:d%96<48?Math.PI:0});
 for(const part of createFoodCartParts()){
  w.resources.add(part.material);if(part.material.map)w.resources.add(part.material.map);
  w.batch(part.geometry,part.material,placements,part.castShadow!==false);
 }
 const kerbs=[],pavers=[],benches=[],frames=[],bulbs=[];
 for(let d=-10;d<w.length+10;d+=1.2){for(const side of [-1,1]){
  const x=routeX(d,'city');kerbs.push({x:x+side*3.65,y:.1,z:-d,sx:.23,sy:.2,sz:1.17});
  pavers.push({x:x+side*4.55,y:.055,z:-d,sx:1.5,sy:.1,sz:1.16,color:['#b5ae9c','#a89f89','#c5bbaa'][Math.floor(w.rng()*3)]});
 }}
 for(let d=22;d<w.length;d+=36){
  const x=routeX(d,'city');for(const side of [-1,1]){
   for(let j=0;j<5;j++)benches.push({x:x+side*4.6+(j-2)*.095,y:.49,z:-d,sx:.075,sy:.08,sz:1.8});
   for(const dz of [-.65,.65])frames.push({x:x+side*4.6,y:.26,z:-d+dz,sx:.38,sy:.45,sz:.055});
  }
  const pts=[];for(let k=0;k<=24;k++){const t=k/24;pts.push(new T.Vector3(x-6+12*t,5-.95*Math.sin(t*Math.PI),-d));if(k%3===0)bulbs.push({x:pts[k].x,y:pts[k].y-.12,z:-d,sx:.055,sy:.085,sz:.055});}
  const g=new T.BufferGeometry().setFromPoints(pts),m=new T.LineBasicMaterial({color:'#443b31'});w.resources.add(g);w.resources.add(m);w.scene.add(new T.Line(g,m));
 }
 w.batch(new T.BoxGeometry(1,1,1),w.mat('#b8b0a0'),kerbs);
 w.batch(new T.BoxGeometry(1,1,1),w.mat('#ffffff'),pavers);
 w.batch(new T.BoxGeometry(1,1,1),w.mat('#72523b',{map:w.texture('lake-wood.webp')}),benches);
 w.batch(new T.BoxGeometry(1,1,1),w.mat('#353d38',{metalness:.5}),frames);
 w.batch(new T.SphereGeometry(1,8,6),w.mat('#fff4cf',{emissive:'#ffd890',emissiveIntensity:1.4}),bulbs,false);
}
