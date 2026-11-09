import * as T from 'three';
import {addDaylight,addReflectingLake,addStreetDetails} from './environment.js';
import {buildWoodland} from './forest.js';
import {ROUTES,routeX} from './routes.js';
const textureAssets={'forest-photo.jpg':new URL('../assets/textures/forest-photo.jpg',import.meta.url).href,'forest-dirt.webp':new URL('../assets/textures/forest-dirt.webp',import.meta.url).href,'lake-wood.webp':new URL('../assets/textures/lake-wood.webp',import.meta.url).href,'pine-foliage.webp':new URL('../assets/textures/pine-foliage.webp',import.meta.url).href,'grass.webp':new URL('../assets/textures/grass.webp',import.meta.url).href,'rock.webp':new URL('../assets/textures/rock.webp',import.meta.url).href,'city-stone.webp':new URL('../assets/textures/city-stone.webp',import.meta.url).href,'pine-bark.webp':new URL('../assets/textures/pine-bark.webp',import.meta.url).href};
const asset=n=>textureAssets[n];
const seedRandom=(seed)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
export class World {
 constructor(container,{quality='balanced'}={}){
  this.container=container;this.quality=quality;this.disposed=false;this.route='forest';this.last=0;this.targets=[];
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,quality==='low'?1:1.5));this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
  this.renderer.shadowMap.enabled=quality!=='low';this.renderer.shadowMap.type=T.PCFSoftShadowMap;container.appendChild(this.renderer.domElement);
  this.camera=new T.PerspectiveCamera(62,1,.1,150);this.camera.position.set(0,1.65,0);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
 }
 resize(){const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight);this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 texture(name,repeat=1){const tex=new T.TextureLoader().load(asset(name),()=>{},undefined,()=>this.container.dispatchEvent(new CustomEvent('asseterror',{detail:name})));tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(repeat,repeat);tex.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());this.resources.add(tex);return tex;}
 mat(color,extra={}){const m=new T.MeshStandardMaterial({color,roughness:.9,...extra});this.resources.add(m);return m;}
 mesh(g,m,x=0,y=0,z=0){this.resources.add(g);const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;this.scene.add(o);return o;}
 box(w,h,d,m,x,y,z){return this.mesh(new T.BoxGeometry(w,h,d),m,x,y,z);}
 batch(g,m,placements,shadow=true){if(!placements.length)return;this.resources.add(g);const inst=new T.InstancedMesh(g,m,placements.length);const dummy=new T.Object3D();placements.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.scale.set(p.sx??1,p.sy??1,p.sz??1);dummy.rotation.set(p.rx??0,p.ry??0,p.rz??0);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);if(p.color)inst.setColorAt(i,new T.Color(p.color));});inst.castShadow=shadow;inst.receiveShadow=true;inst.computeBoundingSphere();this.scene.add(inst);this.resources.add(inst);return inst;}
 disposeScene(){this.sun?.shadow?.map?.dispose();if(this.resources)for(const r of this.resources)r.dispose();this.resources=new Set();this.targets=[];}
 build(id){this.disposeScene();this.route=id;this.waterMaterial=null;this.woodland=null;this.scene=new T.Scene();this.rng=seedRandom(id==='forest'?42:id==='lake'?84:126);this.length=ROUTES[id].length;
  const sky=id==='forest'?'#aebbaa':id==='lake'?'#b1d5df':'#c4d5df';this.scene.background=new T.Color(sky);this.scene.fog=new T.Fog(sky,id==='forest'?30:42,id==='forest'?138:125);
  this.scene.add(new T.HemisphereLight('#e7f2fc',id==='forest'?'#a6a486':'#a1977f',id==='forest'?1.15:1.65));
  this.sun=new T.DirectionalLight('#fff0d4',id==='forest'?3.4:3.0);this.sun.position.set(-22,38,15);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-28,right:28,top:34,bottom:-34,near:1,far:100});this.sun.shadow.bias=-.00035;this.sun.shadow.normalBias=.035;this.scene.add(this.sun);this.scene.add(this.sun.target);
  const dirt=this.mat(id==='forest'?'#d3c4a4':'#b1ad8f',{map:this.texture('forest-dirt.webp',55)});if(id!=='forest')this.mesh(new T.PlaneGeometry(340,this.length+300),dirt,0,-.10,-this.length/2).rotation.x=-Math.PI/2;
  this.makePath(id);
  if(id==='forest')this.woodland=buildWoodland(this);else if(id==='city')this.city();else{this.woodland=buildWoodland(this,{treesOnly:true});this.nature(id);this.lake();}
  this.daylight=addDaylight(this);if(id==='lake')this.waterMaterial=addReflectingLake(this,this.daylight.sun);if(id==='city')addStreetDetails(this);
  this.makeStations();this.render({distance:0,index:0,phase:'idle',elapsed:0,reps:0,station:ROUTES[id].stations[0]},0);
 }
 makePath(id){const vertices=[],uvs=[],indices=[],width=id==='city'?7:id==='lake'?4:1.9;const count=Math.ceil(this.length+30);for(let i=0;i<=count;i++){const d=i-10,x=routeX(d,id),edge=id==='forest'?.09*Math.sin(d*1.7)+.05*Math.sin(d*4.1):0;vertices.push(x-width/2-edge,.015,-d,x+width/2+edge,.015,-d);uvs.push(0,i/4,width/2,i/4);if(i<count){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();const material=this.mat(id==='forest'?'#cfc7af':'#ffffff',{map:this.texture(id==='forest'?'forest-photo.jpg':ROUTES[id].ground),roughness:id==='lake'?.85:.96});this.mesh(geo,material);
  if(id==='lake'){const posts=[],rails=[];for(let d=-8;d<this.length+10;d+=4){const x=routeX(d,id);for(const side of [-1,1]){posts.push({x:x+side*2.2,y:.55,z:-d,sx:.12,sy:1.1,sz:.12});rails.push({x:x+side*2.2,y:.95,z:-d-2,sx:.07,sy:.08,sz:4.2,ry:-(routeX(d+4,id)-x)/4});}}const wood=this.mat('#8b7658');this.batch(new T.BoxGeometry(1,1,1),wood,posts);this.batch(new T.BoxGeometry(1,1,1),wood,rails);}
 }
 nature(id){const random=this.rng,trunks=[],crowns=[],rocks=[],grass=[];const n=id==='forest'?220:0;
  for(let i=0;i<n;i++){const d=random()*(this.length+100)-35,side=id==='lake'?-1:(random()>.5?1:-1);const x=routeX(d,id)+side*(3.8+random()*24),z=-d;const h=5+random()*5;
   trunks.push({x,y:h*.45,z,sx:.22+random()*.18,sy:h*.9,sz:.22+random()*.18,ry:random()*6});
   // Crossed alpha cards: detailed irregular canopy edges, one instanced material.
   for(let j=0;j<32;j++){const a=j*2.4+random(),r=Math.sqrt(random())*3.2;crowns.push({x:x+Math.cos(a)*r,y:h+(random()-.5)*2,z:z+Math.sin(a)*r,sx:2.5+random()*2,sy:2+random(),sz:1,rx:(random()-.5)*1.8,ry:random()*Math.PI,rz:(random()-.5)*.6,color:['#b4c39c','#d4dab6','#aabb8d','#c0cba3'][i%4]});}
  }
  const bark=this.texture('pine-bark.webp');bark.repeat.set(1,3);
  this.batch(new T.CylinderGeometry(.8,1,1,9),this.mat('#b4a390',{map:bark}),trunks);
  const leaf=this.mat('#ffffff',{map:this.texture('pine-foliage.webp'),alphaTest:.42,side:T.DoubleSide,roughness:1});
  this.batch(new T.PlaneGeometry(1,1),leaf,crowns);
  for(let i=0;i<160;i++){const d=random()*(this.length+40)-10,side=id==='lake'?-1:(random()>.5?1:-1),s=.4+random()*1.5;rocks.push({x:routeX(d,id)+side*(3.3+random()*13),y:s*.22,z:-d,sx:s,sy:s*.7,sz:s*.9,ry:random()*6,color:['#8a8d7d','#a1a18d','#747c70'][i%3]});}
  this.batch(new T.IcosahedronGeometry(1,1),this.mat('#b2b2a4',{map:this.texture('rock.webp',1)}),rocks);
  for(let i=0;i<2200;i++){const d=random()*(this.length+30)-10,side=id==='lake'?-1:(random()>.5?1:-1);grass.push({x:routeX(d,id)+side*(2.8+random()*12),y:0,z:-d,sx:.65+random()*.7,sy:.45+random()*.6,sz:1,ry:random()*Math.PI,color:['#7e8b50','#929768','#657840'][i%3]});}
  const grassGeo=new T.PlaneGeometry(1,1);grassGeo.translate(0,.5,0);
  this.batch(grassGeo,this.mat('#d3ceac',{map:this.texture('grass.webp'),alphaTest:.45,side:T.DoubleSide}),grass,false);
  // Distant hills remain simple geometry, hidden partly by fog.
  const hills=[];for(let i=0;i<16;i++)hills.push({x:(id==='lake'?70:65)*(i%2?1:-1),y:-3,z:30-i*28,sx:25+random()*25,sy:6+random()*9,sz:30});this.batch(new T.IcosahedronGeometry(1,2),this.mat('#829b79'),hills,false);
 }
 lake(){
  const reeds=[];for(let d=0;d<this.length;d+=1.7)for(let j=0;j<3;j++)reeds.push({x:8+this.rng()*2,y:.45,z:-d+this.rng(),sx:.035,sy:.6+this.rng(),sz:.035,rz:(this.rng()-.5)*.2});this.batch(new T.CylinderGeometry(1,1,1,4),this.mat('#7c8650'),reeds,false);
 }
 city(){const random=this.rng,wallColors=['#d9c8a6','#d5b797','#e0d5ba','#c7c3b1'];const walls=wallColors.map(c=>this.mat(c,{map:this.texture('city-stone.webp',.25)}));const dark=this.mat('#304c4c');const roofs=this.mat('#a96949');const metal=this.mat('#333e38');const panes=this.mat('#eacb88',{emissive:'#b68b39',emissiveIntensity:.2});const blocks=[[],[],[],[]],windows=[],shutters=[],roofParts=[],ledges=[],pots=[],bushes=[],lamps=[];
  for(let d=-12;d<this.length+25;d+=12){for(const side of [-1,1]){const h=6+Math.floor(random()*3)*2,w=7+random()*2,x=routeX(d,'city')+side*10;
   blocks[Math.floor(random()*4)].push({x,y:h/2,z:-d,sx:w,sy:h,sz:10});roofParts.push({x,y:h+.3,z:-d,sx:w+1,sy:.55,sz:11});
   for(let floor=0;floor<Math.floor(h/2.7);floor++)for(let k=-1;k<=1;k++){const z=-d+k*2.8,y=1.8+floor*2.7,front=x-side*(w/2+.03);windows.push({x:front,y,z,sx:.08,sy:1.3,sz:.82});shutters.push({x:front-side*.06,y,z:z-.62,sx:.12,sy:1.4,sz:.3});shutters.push({x:front-side*.06,y,z:z+.62,sx:.12,sy:1.4,sz:.3});ledges.push({x:front-side*.12,y:y-.75,z,sx:.35,sy:.12,sz:1.7});}
   pots.push({x:routeX(d,'city')+side*4.4,y:.38,z:-d+4,sx:.5,sy:.75,sz:.5});bushes.push({x:routeX(d,'city')+side*4.4,y:1.1,z:-d+4,sx:.65,sy:.55,sz:.65});
   lamps.push({x:routeX(d,'city')+side*4.6,y:1.6,z:-d-4,sx:.06,sy:3.2,sz:.06});
   windows.push({x:routeX(d,'city')+side*4.6,y:3.25,z:-d-4,sx:.25,sy:.45,sz:.25});
  }}
  blocks.forEach((a,i)=>this.batch(new T.BoxGeometry(1,1,1),walls[i],a));
  this.batch(new T.BoxGeometry(1,1,1),panes,windows);this.batch(new T.BoxGeometry(1,1,1),dark,shutters);this.batch(new T.BoxGeometry(1,1,1),walls[0],ledges);this.batch(new T.BoxGeometry(1,1,1),roofs,roofParts);this.batch(new T.CylinderGeometry(.9,.7,1,10),roofs,pots);this.batch(new T.IcosahedronGeometry(1,2),this.mat('#57724b'),bushes);this.batch(new T.BoxGeometry(1,1,1),metal,lamps);
 }
 makeStations(){
  const wood=this.mat('#b7a58c',{map:this.texture('pine-bark.webp')});
  const rock=this.mat('#b5b5a8',{map:this.texture('rock.webp',1)});
  const rope=this.mat('#a2936a');const fruit=this.mat('#e5a844',{roughness:.7});const crate=this.mat('#a68962',{map:this.texture('lake-wood.webp')});
  for(const s of ROUTES[this.route].stations){const d=s.at+4,x=routeX(d,this.route);const group=new T.Group();group.position.set(x,0,-d);group.userData.at=d;this.scene.add(group);
   const add=(geo,mat,px,py,pz,rx=0,rz=0)=>{this.resources.add(geo);const m=new T.Mesh(geo,mat);m.position.set(px,py,pz);m.rotation.set(rx,0,rz);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;};
   const branch=(px,py,pz,length,angle=0,radius=.12)=>add(new T.CylinderGeometry(radius*.7,radius,length,8),wood,px,py,pz,0,angle);
   if(s.event==='duck'&&this.route==='city'){
    add(new T.BoxGeometry(4.5,.16,1.3),this.mat('#a85c38'),0,1.45,0);branch(-2.2,.75,0,1.5);branch(2.2,.75,0,1.5);
   }else if(s.event==='duck'){
    // A fallen pine across the path: its root plate on the left bank, the crown end resting on a boulder on the right.
    // The trunk passes at head height over the path, so ducking has a reason (no stick pile).
    const boulder=add(new T.IcosahedronGeometry(1,2),rock,3.1,.55,.2);boulder.scale.set(1.25,1.35,1.1);
    const trunk=add(new T.CylinderGeometry(.34,.2,8.4,14),wood,-.2,1.38,0,0,Math.PI/2+.13);trunk.material=trunk.material.clone();this.resources.add(trunk.material);trunk.material.map=trunk.material.map.clone();trunk.material.map.repeat.set(1,6);trunk.material.map.needsUpdate=true;this.resources.add(trunk.material.map);
    const plate=add(new T.IcosahedronGeometry(1,2),this.mat('#4f4033',{map:this.texture('forest-dirt.webp',1),roughness:1}),-4.45,.85,0);plate.scale.set(.42,1.05,1.0);
    const roots=this.mat('#4a3c2f',{roughness:1});for(let j=0;j<5;j++){const a=j/5*Math.PI*2;add(new T.CylinderGeometry(.03,.07,.9,6),roots,-4.55,.92+Math.sin(a)*.7,Math.cos(a)*.6,Math.PI/2-a,0);}
   }else if(s.event==='lean'){
    const l=add(new T.IcosahedronGeometry(1,1),rock,-1.5,1.0,0);l.scale.set(1.1,1.8,1.7);
    const r=add(new T.IcosahedronGeometry(1,1),rock,1.5,.85,-2);r.scale.set(1.1,1.5,1.5);
   }else if(s.event==='squat'){
    for(let j=0;j<3;j++){const m=add(new T.IcosahedronGeometry(1,1),rock,(j%2?-.6:.6),.3,-j*1.2);m.scale.set(1.2,.45,.8);}
   }else if(s.event==='arm_pull'){
    branch(-2.3,1.6,0,3.2,0,.18);branch(2.3,1.6,0,3.2,0,.18);branch(0,3.05,0,4.8,Math.PI/2,.12);
    for(const xx of [-.65,.65]){add(new T.CylinderGeometry(.025,.025,1.6,6),rope,xx,2.25,0);add(new T.TorusGeometry(.13,.025,6,20),rope,xx,1.45,0);}
   }else if(s.event==='reach'){
    branch(-2.5,1.7,0,3.4,.15,.23);branch(-.2,2.5,0,4.7,Math.PI/2-.12,.10);
    for(let j=0;j<4;j++){const xx=-1.1+j*.72,yy=1.9+(j%2)*.35;branch(xx,(yy+2.5)/2,0,2.5-yy,0,.012);add(new T.SphereGeometry(.14,12,8),fruit,xx,yy,0);}
   }else if(s.event==='twist'){
    branch(0,.65,0,1.3,0,.18);add(new T.TorusGeometry(.6,.08,8,32),wood,0,1.3,.12);
    for(let j=0;j<4;j++){const a=j*Math.PI/4;add(new T.BoxGeometry(1.2,.065,.08),wood,0,1.3,.12,0,a);}
   }else if(s.event==='punch'){
    for(let j=0;j<3;j++)add(new T.BoxGeometry(.8,.65,.6),crate,(j-1)*.85,.9+(j%2)*.35,0);
   }else {
    if(this.route==='lake'){add(new T.BoxGeometry(1.5,.12,4),crate,0,.14,0);for(const xx of [-1.4,1.4])branch(xx,.55,0,1.1,0,.07);}
    else {branch(-1.8,1.8,0,3.6,.25,.2);branch(1.8,1.8,0,3.6,-.25,.2);branch(0,3.2,0,3.0,Math.PI/2,.12);}
   }
   // Small world marker, not a synthetic gym gate. Coach overlay carries precise instructions.
   const marker=add(new T.TorusGeometry(.14,.02,6,20),this.mat('#e5cb85',{emissive:'#b99b4a',emissiveIntensity:.3}),0,2.8,.4);group.userData.marker=marker;
   this.targets.push(group);
  }
 }

 render(state,time){if(this.disposed||!this.scene)return;const d=state.distance;this.woodland?.update(d,time);this.camera.position.set(routeX(d,this.route),1.67,-d);this.camera.lookAt(routeX(d+10,this.route),1.64,-d-10);this.sun.position.set(this.camera.position.x-23,34,-d-31);this.daylight?.sky.position.copy(this.camera.position);this.sun.target.position.set(this.camera.position.x,0,-d-12);this.sun.target.updateMatrixWorld();if(this.waterMaterial)this.waterMaterial.uniforms.time.value=time;
  this.targets.forEach((g,i)=>{g.visible=i>=state.index&&g.userData.at-d<65&&!(i===state.index&&state.phase==='rest');if(g.userData.marker)g.userData.marker.position.y=2.8+Math.sin(time*2)*.04;});this.renderer.render(this.scene,this.camera);
 }
 dispose(){this.disposed=true;this.resizeObserver.disconnect();this.disposeScene();this.renderer.dispose();this.renderer.domElement.remove();}
}
