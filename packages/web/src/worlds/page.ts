import {mountBodyArcadeWorlds} from './runtime/src/index.js';
import {browserServices} from '../../../core/loop/browser.ts';
import {createCalibrator} from '../../../core/body/calibrator.ts';
import {createMovementEngine} from '../../../core/moves/engine.ts';
import {HitTester,padAt} from '../../../core/moves/handHit.ts';
import {anglesFromChannels,fitPose} from '../../../core/moves/poseMatch.ts';
import {POSES} from '../../../core/moves/poses.ts';
import {POSE_MODEL,WASM_BASE} from '../../../core/pose/assets.ts';
import type {CameraLease,PoseFrame,DetectorSpec} from '../../../core/types/index.ts';
import {routeAction} from './movement-bridge.ts';

/** Additive exploration page. Uses the SAME camera, pose model, calibration and movement detectors as existing games. */
export function bootWorlds():()=>void{
 const body=document.body;body.innerHTML='';body.style.cssText='margin:0;background:#20352d';
 const host=document.createElement('div');host.style.cssText='height:100dvh;min-height:720px;width:100%';body.append(host);
 const query=new URLSearchParams(location.search);const route=['forest','lake','city'].includes(query.get('route')??'')?query.get('route')!:'forest';
 const app=mountBodyArcadeWorlds(host,{route,mode:'live',quality:query.get('quality')==='low'?'low':'balanced',onComplete:()=>stopCamera()});
 const responsive=document.createElement('style');responsive.textContent='@media(max-width:760px){.tracker{display:none}}';host.shadowRoot?.append(responsive);
 const dock=document.createElement('section');dock.id='worldCameraDock';dock.style.cssText='position:absolute;top:112px;left:28px;z-index:5;max-width:260px;padding:12px;border-radius:14px;background:#11251deb;color:#f4f6ef;font:12px system-ui;border:1px solid #ffffff30';
 dock.innerHTML='<div style="display:flex;gap:8px"><button id="openCam">Enable camera</button><button id="stopCam">Stop camera</button><a href="/" style="color:#d5edaa;padding:8px">Exit</a></div><p id="cameraStatus" role="status">Enable your camera, then stand still for calibration.</p><video id="selfView" muted playsinline style="display:none;width:150px;border-radius:8px;transform:scaleX(-1)"></video>';
 dock.querySelectorAll('button').forEach(b=>{b.style.cssText='border:1px solid #ffffff30;border-radius:8px;background:#334c3c;color:white;padding:8px;cursor:pointer';});body.append(dock);const dockStyle=document.createElement('style');dockStyle.textContent='@media(max-width:760px){#worldCameraDock{top:128px!important;left:16px!important;right:16px;max-width:none!important}#worldCameraDock video{width:80px!important;position:absolute;right:10px;top:10px}#worldCameraDock:has(video[style*=block]){padding-right:100px!important}}';body.append(dockStyle);
 const status=dock.querySelector('#cameraStatus')!;const enable=dock.querySelector<HTMLButtonElement>('#openCam')!;const stop=dock.querySelector<HTMLButtonElement>('#stopCam')!;const video=dock.querySelector<HTMLVideoElement>('#selfView')!;
 const services=browserServices(),cal=createCalibrator(),moves=createMovementEngine();let lease:CameraLease|null=null,offFrame:(()=>void)|null=null,offEnded:(()=>void)|null=null,controller:AbortController|null=null,disposed=false,ready=false,busy=false,lastSeated=false,lastPose=0,poseHeld=false,targetId=0,lastTargetAt=-Infinity;const hit=new HitTester();
 const specs:DetectorSpec[]=[{id:'squat'},{id:'lean'},{id:'pull'},{id:'twist'},{id:'handHit'},{id:'poseMatch'}];moves.use(specs);
 const offMoves=moves.onEvent(e=>{if(!ready||app.getState().paused)return;const action=routeAction(e,app.engine.expected);if(action)app.input.movement(action);});
 const message=(s:string)=>{status.textContent=s;};
 function calibrate(){ready=false;lastPose=0;poseHeld=false;lastSeated=app.getState().seated;cal.begin(lastSeated?'upper':'full',{headroom:'arms-up',fallback:true});moves.reset();app.input.tracking(false);message('Stand still with shoulders and hips visible. Then raise both hands when prompted.');}
 function stopCamera(){controller?.abort();controller=null;offFrame?.();offFrame=null;offEnded?.();offEnded=null;services.pose.detach();lease?.release();lease=null;video.srcObject=null;video.style.display='none';ready=false;busy=false;enable.disabled=false;app.input.tracking(false);message('Camera stopped. You can use keyboard / touch practice.');}
 function frame(f:PoseFrame){
  if(disposed||app.getState().mode!=='live'||f.source!=='camera')return;
  if(lastSeated!==app.getState().seated)calibrate();
  if(!ready){const s=cal.push(f);message(s.code==='raise_hands'?'Raise both hands above your head.':s.ready?'Ready — start exploring.':`Calibration ${Math.round(s.progress*100)}% · ${s.code.replaceAll('_',' ')}`);if(s.ready){const profile=cal.profile();if(profile){if(profile.framing!=='full'&&!lastSeated){const seat=host.shadowRoot?.querySelector<HTMLInputElement>('#seated');if(seat){seat.checked=true;seat.dispatchEvent(new Event('change'));}lastSeated=true;}moves.setProfile(profile);ready=true;}}return;}
  const features=moves.push(f);app.input.tracking(features.ok&&f.source==='camera');if(!features.ok){message('Step back into view. The route is paused.');return;}message('Tracking active · all camera processing stays on this device.');
  if(app.getState().paused||!['travel','station'].includes(app.engine.phase))return;
  const ch=moves.channels(),expected=app.engine.phase==='travel'?'reach':app.engine.expected;
  if(expected==='reach'||expected==='punch'){
   const side=targetId%2===0?'L':'R';const at=padAt(ch,side==='L'?-.6:.6,expected==='punch'?.1:.45);
   const target={id:targetId,x:at.x,y:at.y,r:(ch['body.a']??1)*.4,side,dwellMs:expected==='reach'?80:0,minSpeed:expected==='punch'?1.2:0} as const;
   if(f.t-lastTargetAt>450){const hits=hit.update(ch,[target]);if(hits.length){app.input.movement(expected);targetId++;lastTargetAt=f.t;}}
  }
  if(expected==='pose_hold'){
   // Same limb-angle matcher as Pose Wall, upper-body T pose in both seated and standing modes.
   const tPose=POSES[0]!;const limbs=Object.fromEntries(Object.entries(tPose.limbs).filter(([k])=>!k.startsWith('thigh')&&!k.startsWith('shin')));
   const fits=fitPose(anglesFromChannels(ch),{name:'upperT',limbs},28).matched;
   if(fits){if(!lastPose)lastPose=f.t;if(f.t-lastPose>=1000&&!poseHeld){app.input.movement('pose_hold');poseHeld=true;}}else{lastPose=0;poseHeld=false;}
  }else{lastPose=0;poseHeld=false;}
 }
 async function startCamera(){if(busy||lease)return;busy=true;enable.disabled=true;const ac=new AbortController();controller=ac;try{
  message('Loading the camera and movement model…');const acquired=await services.camera.acquire({signal:ac.signal});if(disposed||ac.signal.aborted){acquired.release();return;}lease=acquired;
  video.srcObject=lease.stream;video.style.display='block';await video.play();await services.pose.load({modelUrl:POSE_MODEL.url,wasmBase:WASM_BASE,prefer:'GPU',maxHz:20,signal:ac.signal});if(disposed||ac.signal.aborted)return;
  await services.pose.warmUp();if(disposed||ac.signal.aborted)return;calibrate();offFrame=services.pose.onFrame(frame);offEnded=lease.onEnded(()=>{stopCamera();app.pause();message('Camera disconnected. Re-enable it to continue.');});services.pose.attach(lease);
 }catch(e){if(!ac.signal.aborted){stopCamera();message('Camera unavailable: '+(e instanceof Error?e.message:'Check permission and camera availability.'));}}finally{if(controller===ac){busy=false;enable.disabled=!!lease;}}}
 enable.addEventListener('click',()=>{const select=host.shadowRoot?.querySelector<HTMLSelectElement>('#mode');if(select&&select.value!=='live'){select.value='live';select.dispatchEvent(new Event('change'));}void startCamera();});stop.addEventListener('click',stopCamera);
 const offMode=()=>{if(app.getState().mode!=='live'&&(lease||busy))stopCamera();};host.shadowRoot?.querySelector('#mode')?.addEventListener('change',offMode);
 const hide=()=>{if(document.hidden){stopCamera();app.pause();}};document.addEventListener('visibilitychange',hide);
 const dispose=()=>{if(disposed)return;disposed=true;stopCamera();offMoves();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',dispose);app.destroy();dock.remove();dockStyle.remove();host.remove();};window.addEventListener('pagehide',dispose);
 return dispose;
}
