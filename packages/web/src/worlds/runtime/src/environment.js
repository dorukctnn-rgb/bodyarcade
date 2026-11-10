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
 // Wooded islands and a far shore in the haze: a real silhouette to look at and to see mirrored in the water.
 addIslands(w);
 return water.material;
}

// Low islands out on the lake, 15-30 m off the boardwalk, one every 60-85 m. Each is its own piece of terrain: an uneven shoreline, a rocky rim that
// slopes into the water, sand and stone at the waterline and grass on the crown, all in vertex colour; the same modelled
// broadleaf trees as the bank (their far detail level), bushes along the tree line and boulders on the shore. Beyond them a
// far shore, pale in the haze. No shadows (they are 40 m and more away); fewer trees and bushes on the low tier and phones.
function addIslands(w){
 const r=w.rng,few=w.quality==='low'||matchMedia('(pointer: coarse)').matches,variants=w.woodland?.variants??[];
 const RINGS=12,SEG=48,pos=[],col=[],idx=[],rocks=[],bushes=[],ridge=[],groves=[],kinds=variants.slice(0,3);
 const wet=new T.Color('#5c5a4c'),stone=new T.Color('#85836f'),sand=new T.Color('#a59b7a'),meadow=new T.Color('#6e7c45'),grass=new T.Color('#55693a'),shade=new T.Color('#425430'),c=new T.Color();
 for(let z0=-40;z0>-w.length-90;z0-=60+r()*25){
  const isl={x:30+r()*14,z:z0,R:10+r()*8,H:2+r()*1.6,p:r()*6.28,q:r()*6.28};
  const edge=a=>1+.16*Math.sin(3*a+isl.p)+.09*Math.sin(5*a+isl.q)+.05*Math.sin(9*a+isl.p*2);
  const at=(t,a)=>{const e=edge(a),k=Math.max(0,1-t*t),y=(isl.H+.55)*Math.pow(k,1.15)-.55+.32*t*(1-t)*Math.sin(4*a+isl.q)*Math.sin(7*t+isl.p);
   return [isl.x+Math.cos(a)*t*isl.R*.75*e,y,isl.z+Math.sin(a)*t*isl.R*e];};
  const base=pos.length/3;
  for(let i=0;i<=RINGS;i++)for(let j=0;j<(i?SEG:1);j++){
   const t=i/RINGS,a=j/SEG*Math.PI*2,[x,y,z]=at(t,a),n=(Math.sin(x*1.3+z*.7)*Math.sin(z*1.1-x*.5)+1)*.5;
   if(y<.06)c.copy(wet).lerp(stone,n*.7);else if(y<.42)c.copy(stone).lerp(sand,n);else c.copy(meadow).lerp(n>.5?grass:shade,Math.min(1,(y-.42)*1.6)*(.45+n*.55));
   pos.push(x,y,z);col.push(c.r,c.g,c.b);
  }
  const ring=(i,j)=>base+(i?1+(i-1)*SEG+((j+SEG)%SEG):0);
  for(let j=0;j<SEG;j++)idx.push(ring(0,0),ring(1,j+1),ring(1,j));
  for(let i=1;i<RINGS;i++)for(let j=0;j<SEG;j++){const a=ring(i,j),b=ring(i,j+1),cc=ring(i+1,j),d=ring(i+1,j+1);idx.push(a,b,cc,b,d,cc);}
  // Boulders where the land meets the water.
  for(let k=0;k<(few?8:14);k++){const a=r()*Math.PI*2,[x,,z]=at(.8+r()*.12,a),s=.5+r()*1.1;rocks.push({x,y:-.1+s*.2,z,sx:s*1.25,sy:s*.62,sz:s,ry:r()*6,color:['#8a8d7d','#9c9b88','#747c70'][k%3]});}
  // Bushes along the tree line, trees on the crown, taller toward the middle.
  for(let k=0;k<(few?6:12);k++){const a=r()*Math.PI*2,[x,y,z]=at(.55+r()*.22,a),s=.7+r()*.9;bushes.push({x,y:y+s*.22,z,sx:s*1.3,sy:s*.75,sz:s*1.1,ry:r()*6,color:['#3f5530','#4a6234','#3a4f2c','#536a37'][k%4]});}
  // One grove per island (oak, ash and aspen), so an island out of view or behind the camera is not drawn at all.
  const grove=kinds.map(()=>[]);groves.push(grove);
  if(kinds.length)for(let k=0;k<(few?10:22);k++){const t=Math.sqrt(r())*.66,a=r()*Math.PI*2,[x,y,z]=at(t,a),s=(.1+r()*.07)*(1.15-t*.5);
   grove[k%kinds.length].push({x,y:y-.15,z,sx:s*.85,sy:s*(.9+r()*.25),sz:s*.85,ry:r()*6.28,rz:(r()-.5)*.06});}
 }
 const land=new T.BufferGeometry();land.setAttribute('position',new T.Float32BufferAttribute(pos,3));land.setAttribute('color',new T.Float32BufferAttribute(col,3));land.setIndex(idx);land.computeVertexNormals();
 w.mesh(land,w.mat('#ffffff',{vertexColors:true,roughness:1})).castShadow=false;
 w.batch(new T.IcosahedronGeometry(1,1),w.mat('#b2b2a4',{map:w.texture('rock.webp',1)}),rocks,false);
 // A lumpy bush: an icosahedron pushed in and out so no two sides read the same, shaded round (normals point outward from
 // the centre, so the shared corners of its faces get one normal).
 const bush=new T.IcosahedronGeometry(1,2),bp=bush.attributes.position,bn=bush.attributes.normal;for(let i=0;i<bp.count;i++){const x=bp.getX(i),y=bp.getY(i),z=bp.getZ(i),k=1+.18*Math.sin(x*5.1+z*3.7)+.12*Math.sin(y*6.3-x*2.9);bp.setXYZ(i,x*k,Math.max(-.35,y)*k,z*k);bn.setXYZ(i,x,y,z);}
 w.batch(bush,w.mat('#ffffff',{roughness:.95}),bushes,false);
 const lod=w.quality==='low'?2:1;for(const grove of groves)kinds.forEach((v,i)=>{w.batch(v.geo[lod].branches,v.bark,grove[i],false);w.batch(v.geo[lod].leaves,v.leaf,grove[i],false);});
 for(let i=0;i<14;i++)ridge.push({x:104+r()*14,y:-2.5,z:50-i*30,sx:20+r()*16,sy:5+r()*6,sz:22,ry:r()*6,color:['#5d7466','#667d6c','#57705f'][i%3]});
 w.batch(new T.IcosahedronGeometry(1,2),w.mat('#ffffff',{roughness:1}),ridge,false);
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
