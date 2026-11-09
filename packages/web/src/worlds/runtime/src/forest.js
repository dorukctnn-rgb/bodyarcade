import * as T from 'three';
import {addMossBanks} from './environment.js';
import {Tree} from '../vendor/ez-tree/ez-tree.js';
import {routeX} from './routes.js';
const urls={floor:new URL('../assets/textures/forest-photo.jpg',import.meta.url),floorNormal:new URL('../assets/textures/forest-photo-normal.jpg',import.meta.url),floorRough:new URL('../assets/textures/forest-photo-rough.jpg',import.meta.url),oak:new URL('../assets/textures/ez-oak.png',import.meta.url),ash:new URL('../assets/textures/ez-ash.png',import.meta.url),aspen:new URL('../assets/textures/ez-aspen.png',import.meta.url),bark:new URL('../assets/textures/ez-bark.jpg',import.meta.url),normal:new URL('../assets/textures/ez-bark-normal.jpg',import.meta.url),rough:new URL('../assets/textures/ez-bark-roughness.jpg',import.meta.url)};
export function forestHeight(x,z){const edge=Math.abs(x-routeX(-z,'forest'));return -.06+Math.min(1,Math.max(0,(edge-1.1)/5))*(.38+Math.sin(x*.19+z*.1)*.6+Math.sin(z*.21)*.25);}
export function buildWoodland(w,{treesOnly=false}={}){
 const treeRoute=treesOnly?w.route:'forest';
 const mobile=matchMedia('(pointer: coarse)').matches||w.quality==='low';
 const rnd=w.rng,loader=new T.TextureLoader(),shaders=[],chunks=[];
 const tex=(key,color=true)=>{const t=loader.load(urls[key].href,undefined,undefined,()=>w.container.dispatchEvent(new CustomEvent('asseterror',{detail:key})));t.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=4;w.resources.add(t);return t;};
 const bark=tex('bark'),normal=tex('normal',false),rough=tex('rough',false),leaves=[tex('oak'),tex('ash'),tex('aspen')];
 // Seeded botanical variants share meshes; distance bands share each skeleton.
 const variants=[];
 for(let i=0;i<6;i++){
  const tree=new Tree();tree.loadPreset(['Oak Medium','Ash Medium','Aspen Medium'][i%3]);tree.options.seed=1700+i*319;
  tree.options.bark.textureScale.y=2.5;tree.options.bark.maps={color:bark,normal,roughness:rough};tree.options.bark.tint=0xb9b5a0;
  tree.options.leaves.map=leaves[i%3];tree.options.leaves.tint=[0x9caf65,0xa9bd79,0xb6c784][i%3];tree.options.leaves.size*=.85;tree.generate();
  const leaf=tree.leavesMesh.material;leaf.onBeforeCompile=(s)=>{s.uniforms.forestTime={value:0};s.vertexShader='uniform float forestTime;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x += sin(forestTime*.55+position.y*.7+position.x*.31)*.09*smoothstep(2.,20.,position.y);');shaders.push(s);};leaf.customProgramCacheKey=()=> 'bodyarcade-forest-wind-v2';
  const detail=[{}, {sectionStride:2,segmentFactor:.65,leafStride:3,leafScale:1.6,billboard:'single'}, {sectionStride:3,segmentFactor:.5,leafStride:6,leafScale:2.2,billboard:'single'}];
  const geo=detail.map(d=>tree.createGeometry(d));geo.forEach(g=>{w.resources.add(g.branches);w.resources.add(g.leaves)});w.resources.add(tree.branchesMesh.material);w.resources.add(leaf);
  tree.branchesMesh.geometry.dispose();tree.leavesMesh.geometry.dispose();variants.push({geo,bark:tree.branchesMesh.material,leaf});
 }
 for(let cell=-1;cell<12;cell++){
  const positions=Array.from({length:6},()=>[]);
  for(let i=0;i<(mobile?30:48);i++){const d=cell*26+rnd()*26,side=treesOnly?-1:(rnd()<.5?-1:1),x=routeX(d,treeRoute)+side*((treesOnly?5:3.3)+Math.pow(rnd(),.8)*31),z=-d,s=.25+rnd()*.22;positions[i%6].push({x,y:treesOnly?-.1:forestHeight(x,z)-.06,z,sx:s*.8,sy:s*(.9+rnd()*.25),sz:s*.8,ry:rnd()*6.28,rz:(rnd()-.5)*.07});}
  const bands=[[],[],[]];for(let v=0;v<6;v++)for(let lod=0;lod<3;lod++){
   const a=variants[v],g=a.geo[lod];bands[lod].push(w.batch(g.branches,a.bark,positions[v],lod===0),w.batch(g.leaves,a.leaf,positions[v],lod===0));
  }chunks.push({center:cell*26+13,bands});
 }
 if(treesOnly)return{update(d,time){shaders.forEach(s=>s.uniforms.forestTime.value=time);for(const c of chunks){const dist=Math.abs(c.center-d),level=dist<24?0:dist<60?1:2;c.bands.forEach((ms,l)=>ms.forEach(m=>m.visible=dist<135&&l===level));}}};
 // Uneven forest floor; a narrow dirt footpath is left open by placement.
 const ground=new T.PlaneGeometry(100,w.length+90,100,340);ground.rotateX(-Math.PI/2);ground.translate(0,0,-w.length/2);const pos=ground.attributes.position;for(let i=0;i<pos.count;i++)pos.setY(i,forestHeight(pos.getX(i),pos.getZ(i)));ground.computeVertexNormals();
 const dirt=tex('floor'),floorNormal=tex('floorNormal',false),floorRough=tex('floorRough',false);for(const t of [dirt,floorNormal,floorRough])t.repeat.set(31.25,(w.length+90)/3.2);
 const groundColors=[];for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),edge=Math.abs(x-routeX(-z,'forest')),patch=(Math.sin(x*.63+z*.17)*Math.sin(z*.39-x*.21)+1)*.5;const c=new T.Color('#d0c8ae').lerp(new T.Color('#707e44'),Math.min(1,Math.max(0,edge-1.4))*patch*.65);groundColors.push(c.r,c.g,c.b);}ground.setAttribute('color',new T.Float32BufferAttribute(groundColors,3));w.mesh(ground,w.mat('#ffffff',{map:dirt,normalMap:floorNormal,normalScale:new T.Vector2(.9,.9),roughnessMap:floorRough,vertexColors:true}));
 // Forest litter fills the bare gaps at a believable leaf scale.
 const litter=[],litterGeo=new T.SphereGeometry(1,5,3);litterGeo.scale(.07,.006,.13);
 for(let i=0;i<(mobile?1600:3600);i++){const d=rnd()*(w.length+20)-10,edge=(rnd()<.5?-1:1)*(1.0+rnd()*8),x=routeX(d,'forest')+edge,z=-d;litter.push({x,y:forestHeight(x,z)+.015,z,ry:rnd()*6.28,rz:rnd()*.15,color:['#857040','#a28a52','#595b2c','#b49b65'][i%4]});}w.batch(litterGeo,w.mat('#ffffff',{roughness:1}),litter,false);
 const mossGeo=new T.IcosahedronGeometry(1,2),mp=mossGeo.attributes.position,mc=[];for(let i=0;i<mp.count;i++){const x=mp.getX(i),y=mp.getY(i),z=mp.getZ(i);mp.setXYZ(i,x*(1+.16*Math.sin(z*8+y*4)),y*.58,z);const c=new T.Color('#74786b').lerp(new T.Color('#56673a'),Math.max(0,y)*.85);mc.push(c.r,c.g,c.b);}mossGeo.setAttribute('color',new T.Float32BufferAttribute(mc,3));mossGeo.computeVertexNormals();const moss=[];for(let i=0;i<34;i++){const d=rnd()*w.length,x=routeX(d,'forest')+(i%2?1:-1)*(2.1+rnd()*3),s=.4+rnd()*.7;moss.push({x,y:forestHeight(x,-d)+.15,z:-d,sx:s,sy:s,sz:s,ry:rnd()*6});}w.batch(mossGeo,w.mat('#ffffff',{map:w.texture('rock.webp'),vertexColors:true}),moss);

 // Curved grass blades and pinnate fern leaves are actual geometry, not flat photo sprites.
 function foliage(fern){const vertices=[],colors=[];const tri=(a,b,c,tint)=>{vertices.push(...a,...b,...c);const co=new T.Color(tint);for(let k=0;k<3;k++)colors.push(co.r,co.g,co.b);};
  if(fern){for(let f=0;f<9;f++){const az=f*2.399,L=.6+(f%3)*.18;const at=(t,side=0)=>[Math.cos(az)*L*t+Math.cos(az+1.57)*side,Math.sin(t*Math.PI*.78)*L*.7,Math.sin(az)*L*t+Math.sin(az+1.57)*side];for(let j=1;j<13;j++){const t=j/14,span=Math.sin(t*Math.PI)*.17;for(const side of [-1,1]){const leaf=(u,wing)=>{const p=at(t+.055*u,span*side*u);const width=Math.sin(u*Math.PI)*.015*wing;p[0]+=Math.cos(az)*width;p[2]+=Math.sin(az)*width;p[1]+=Math.sin(u*Math.PI)*.018;return p;};for(let k=0;k<4;k++){const u=k/4,v=(k+1)/4;tri(leaf(u,-1),leaf(u,1),leaf(v,1),j%2?'#527333':'#6a8b3d');tri(leaf(u,-1),leaf(v,1),leaf(v,-1),j%2?'#527333':'#6a8b3d');}}}}}
  else{for(let b=0;b<7;b++){const az=b*2.399,h=.25+(b%4)*.09,dx=Math.cos(az),dz=Math.sin(az),base=[dx*.08,0,dz*.08];for(let j=0;j<4;j++){const t=j/4,u=(j+1)/4,point=(q,side)=>[base[0]+dx*q*q*.21+dz*side*.025*(1-q),q*h,base[2]+dz*q*q*.21-dx*side*.025*(1-q)];tri(point(t,-1),point(t,1),point(u,1),'#657f36');tri(point(t,-1),point(u,1),point(u,-1),'#435d29');}}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
 }
 const grassGeo=foliage(false),fernGeo=foliage(true),plantMat=w.mat('#ffffff',{vertexColors:true,side:T.DoubleSide});
 plantMat.onBeforeCompile=s=>{s.uniforms.forestTime={value:0};s.vertexShader='uniform float forestTime;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x+=sin(forestTime+position.y*3.)*position.y*.055;');shaders.push(s);};
 const groundChunks=[];
 for(let cell=-1;cell<16;cell++){
  const gs=[],fs=[],rs=[];
  for(let i=0;i<(mobile?380:700);i++){const d=cell*20+rnd()*20,side=rnd()<.5?-1:1,edge=.95+Math.pow(rnd(),1.8)*15,x=routeX(d,'forest')+side*edge,z=-d,s=.45+rnd()*.8;if(Math.sin(d*.37+edge*.8)+Math.sin(d*.13-edge*.42)>-.65)gs.push({x,y:forestHeight(x,z),z,sx:s,sy:s,sz:s,ry:rnd()*6.28});if(i%8===0&&edge>1.4)fs.push({x,y:forestHeight(x,z),z,sx:s*1.1,sy:s*1.1,sz:s*1.1,ry:rnd()*6.28});if(i%70===0)rs.push({x,y:forestHeight(x,z)-.08,z,sx:s*.4,sy:s*.2,sz:s*.32,ry:rnd()*6});}
  const meshes=[w.batch(grassGeo,plantMat,gs,false),w.batch(fernGeo,plantMat,fs,false)];groundChunks.push({center:cell*20+10,meshes});w.batch(new T.IcosahedronGeometry(1,2),w.mat('#7b8070',{map:w.texture('rock.webp')}),rs);
 }
 // Fallen wood, irregular moss-coated boulders, and root flare anchor the woodland.
 const wood=w.mat('#91856b',{map:bark,normalMap:normal,roughnessMap:rough});for(let i=0;i<30;i++){const d=rnd()*w.length,x=routeX(d,'forest')+(i%2?1:-1)*(2.4+rnd()*6);const g=new T.CylinderGeometry(.13,.24,2+rnd()*3,9);const m=w.mesh(g,wood,x,forestHeight(x,-d)+.2,-d);m.rotation.set(0,rnd()*6,Math.PI/2+.06);}
 const updateMoss=addMossBanks(w,forestHeight);
 const update=(d,time)=>{updateMoss(d);shaders.forEach(s=>s.uniforms.forestTime.value=matchMedia('(prefers-reduced-motion: reduce)').matches?0:time);for(const c of chunks){const dist=Math.abs(c.center-d),level=dist<24?0:dist<60?1:2;c.bands.forEach((ms,l)=>ms.forEach(m=>m.visible=dist<135&&l===level));}for(const c of groundChunks)c.meshes.forEach((m,i)=>m.visible=Math.abs(c.center-d)<(i===1?26:48));};update(0,0);return{update};
}
