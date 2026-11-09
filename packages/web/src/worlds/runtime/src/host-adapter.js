import {PoseAdapter} from './pose-adapter.js';
/** The host owns its existing camera + pose pipeline. No duplicate camera/model is started. */
export function connectBodyArcade(engine,{eventTarget=null}={}){
 const pose=new PoseAdapter((type,meta)=>engine.event(type,meta),()=>engine.heartbeat());
 const api={
  movement(type,confidence=1){return engine.event(type,{source:'camera',confidence,time:performance.now()});},
  landmarks(points,timestamp=performance.now()){return pose.update(points,timestamp,{seated:engine.seated});},
  tracking(valid){if(valid)engine.heartbeat();else engine.liveAge=99;},
  recalibrate(){pose.reset();},
  dispose(){eventTarget?.removeEventListener('bodyarcade:movement',listener);pose.reset();}
 };
 const listener=e=>{const d=e.detail;if(d&&typeof d.type==='string')api.movement(d.type,d.confidence??1);};
 eventTarget?.addEventListener('bodyarcade:movement',listener);return api;
}
