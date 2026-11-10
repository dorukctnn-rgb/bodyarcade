import {ROUTES,MOVES,LEVELS} from './routes.js';
export class RouteEngine {
 constructor({route='forest',seated=false,onChange=()=>{},mode='practice',difficulty='beginner'}={}) {this.onChange=onChange;this.reset(route,seated,mode,difficulty);}
 reset(route='forest',seated=false,mode='practice',difficulty='beginner') {if(!ROUTES[route])throw Error('Unknown route');if(!LEVELS[difficulty])throw Error("Unknown difficulty");this.difficulty=difficulty;this.level=LEVELS[difficulty];this.eventTimes=[];this.lastAcceptedAt=-99;this.route={...ROUTES[route],stations:ROUTES[route].stations.map(s=>({...s,reps:Math.ceil(s.reps*this.level.repScale),rest:this.level.rest}))};this.seated=seated;this.mode=mode;this.phase='idle';this.paused=false;this.distance=0;this.credit=0;this.index=0;this.reps=0;this.totalReps=0;this.elapsed=0;this.rest=0;this.prepare=0;this.lastEvent=-Infinity;this.liveAge=99;this.emit();}
 get station(){return this.route.stations[this.index]||null;}
 get expected(){return this.station?(this.seated?this.station.seatedEvent:this.station.event):null;}
 start(){if(this.phase==='idle')this.phase='travel';this.emit();}
 setPaused(v){this.paused=!!v;this.emit();}
 heartbeat(){this.liveAge=0;}
 event(type,{confidence=1,source='practice',time=performance.now()}={}){
  if(!MOVES[type]||!Number.isFinite(confidence)||confidence<.65||!Number.isFinite(time)||time-this.lastEvent<280||this.paused||['idle','complete','rest','prepare'].includes(this.phase))return false;
  if(this.mode==='live'&&source!=='camera')return false;
  if(this.mode==='live')this.heartbeat();
  if(this.phase==='station'&&type!==this.expected)return false;
  if(this.phase==='travel'&&!['reach','arm_pull','punch','twist'].includes(type))return false;
  this.lastEvent=time;
  if(this.phase==='travel'){if(!['reach','arm_pull','punch','twist'].includes(type))return false;this.credit=Math.min(12,this.credit+this.level.credit);}
  else {this.reps++;this.totalReps++;if(this.reps>=this.station.reps){this.phase='rest';this.rest=this.station.rest;this.credit=0;}}
  this.eventTimes.push(this.elapsed);this.eventTimes=this.eventTimes.filter(t=>this.elapsed-t<10);this.lastAcceptedAt=this.elapsed;this.emit();return true;
 }
 tick(dt){dt=Math.max(0,Math.min(.1,dt));this.liveAge+=dt;if(this.paused||['idle','complete'].includes(this.phase))return;
  if(this.mode==='live'&&this.liveAge>1.5)return;
  this.elapsed+=dt;
  if(this.phase==='travel') {const end=this.station?.at??this.route.length;const amount=Math.min(dt*this.level.speed,this.credit,end-this.distance);this.distance+=amount;this.credit-=amount;if(end-this.distance<.001){this.distance=end;this.phase=this.station?'prepare':'complete';this.prepare=this.level.prepare;this.credit=0;}}
  else if(this.phase==='prepare'){this.prepare-=dt;if(this.prepare<=0)this.phase='station';}
  else if(this.phase==='rest'){this.rest-=dt;if(this.rest<=0){this.index++;this.reps=0;this.phase='travel';}}
  this.emit();
 }
 snapshot(){return {route:this.route.id,difficulty:this.difficulty,targetTempo:Math.round(this.level.tempo*(['squat','duck','pose_hold'].includes(this.expected)&&this.phase==='station'?.5:1)),cadence:this.eventTimes.filter(t=>this.elapsed-t<10).length*6,feedback:this.elapsed-this.lastAcceptedAt<.65,seated:this.seated,mode:this.mode,phase:this.phase,paused:this.paused,distance:this.distance,length:this.route.length,progress:this.distance/this.route.length,index:this.index,station:this.station,expected:this.expected,reps:this.reps,totalReps:this.totalReps,elapsed:this.elapsed,rest:this.rest,prepare:this.prepare,trackingLost:this.mode==='live'&&this.liveAge>1.5};}
 emit(){this.onChange?.(this.snapshot());}
}
