// MediaPipe Pose-compatible 33 normalized landmarks. No camera ownership, cloud upload or inference dependency.
// This fallback uses coarse landmarks; prefer the host's tested semantic movement events.
export class PoseAdapter {
 constructor(emit,heartbeat=()=>{}){this.emit=emit;this.heartbeat=heartbeat;this.reset();}
 reset(){this.base=null;this.samples=[];this.last={};this.down=false;this.ducked=false;this.leanSide=0;this.twistSide=0;this.raised=[false,false];this.reached=[false,false];this.punchOut=[false,false];this.poseSince=null;this.poseDone=false;this.previous=null;}
 update(points,time=performance.now(),{seated=false}={}){
  if(!Array.isArray(points)||points.length<33)return false;
  const ids=[11,12,13,14,15,16,23,24];
  if(!ids.every(i=>points[i]&&Number.isFinite(points[i].x)&&Number.isFinite(points[i].y)&&(points[i].visibility??1)>.65))return false;
  this.heartbeat();const p=points;const sx=(p[11].x+p[12].x)/2,sy=(p[11].y+p[12].y)/2,hx=(p[23].x+p[24].x)/2,hy=(p[23].y+p[24].y)/2;
  const span=Math.max(.07,Math.hypot(p[11].x-p[12].x,p[11].y-p[12].y));
  if(!this.base){this.samples.push({sy,hy,span});if(this.samples.length>=45){const avg=k=>this.samples.reduce((s,v)=>s+v[k],0)/this.samples.length;this.base={sy:avg('sy'),hy:avg('hy'),span:avg('span')};}return false;}
  const fire=(type,side='')=>{if(time-(this.last[type]??-Infinity)>500){this.emit(type,{source:'camera',confidence:.8,time,side});this.last[type]=time;}};
  const drop=(sy-this.base.sy)/this.base.span;
  if(drop>.38)this.ducked=true;if(this.ducked&&drop<.16){fire('duck');this.ducked=false;}
  const hipsDrop=(hy-this.base.hy)/this.base.span;
  const legsVisible=[25,26,27,28].every(i=>(p[i]?.visibility??0)>.65);
  if(!seated&&legsVisible){if(hipsDrop>.35)this.down=true;if(this.down&&hipsDrop<.12){fire('squat');this.down=false;}}
  const lean=(sx-hx)/span;const side=lean>.25?1:lean<-.25?-1:0;
  if(side&&side!==this.leanSide){fire('lean',side);this.leanSide=side;}if(!side)this.leanSide=0;
  // Twist proxy requires shoulder depth, not only hand movement.
  const depth=(p[11].z??0)-(p[12].z??0);const twist=depth/span>.45?1:depth/span<-.45?-1:0;
  if(twist&&twist!==this.twistSide){fire('twist',twist);this.twistSide=twist;}
  for(let j=0;j<2;j++){const w=p[15+j],s=p[11+j];const high=w.y<sy-.35*span;const extended=Math.abs(w.x-sx)>.85*span||high;
   if(extended&&!this.reached[j]){fire('reach',j);this.reached[j]=true;}if(!extended)this.reached[j]=false;
   if(high)this.raised[j]=true;if(this.raised[j]&&w.y>sy-.05*span){fire('arm_pull',j);this.raised[j]=false;}
   const forward=(s.z??0)-(w.z??0);const out=forward>span*.65;
   if(this.previous&&out&&!this.punchOut[j]){const dt=(time-this.previous.time)/1000;const old=this.previous.points[15+j];const speed=Math.hypot(w.x-old.x,w.y-old.y,(w.z??0)-(old.z??0))/Math.max(.01,dt);if(speed>.7)fire('punch',j);}
   this.punchOut[j]=out;
  }
  const tPose=Math.abs(p[15].y-sy)<span*.25&&Math.abs(p[16].y-sy)<span*.25&&Math.abs(p[15].x-p[16].x)>span*2;
  if(tPose){this.poseSince??=time;if(time-this.poseSince>1000&&!this.poseDone){fire('pose_hold');this.poseDone=true;}}else{this.poseSince=null;this.poseDone=false;}
  this.previous={time,points:p.map(v=>({...v}))};return true;
 }
}
