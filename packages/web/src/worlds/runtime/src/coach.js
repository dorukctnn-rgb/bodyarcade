import {MOVES} from './routes.js';
// Deterministic vector instruction, not a generated illustration: the limbs show the requested motion.
export function coachSVG(type,time,seated=false){
 const u=(Math.sin(time*2.5)+1)/2;let head=[80,30],neck=[80,44],hip=[80,90],ls=[63,49],rs=[97,49],le=[48,69],re=[112,69],lh=[45,87],rh=[115,87],lk=[65,114],rk=[95,114],lf=[61,143],rf=[99,143];let arrow='';
 if(type==='duck'||type==='squat'){const dy=u*28;for(const p of [head,neck,hip,ls,rs,le,re,lh,rh])p[1]+=dy;lk=[48,116];rk=[112,116];arrow='M133 42 V85 M126 76 L133 85 L140 76';}
 if(type==='lean'||type==='twist'){const dx=Math.sin(time*2.5)*20;for(const p of [head,neck,ls,rs,le,re,lh,rh])p[0]+=dx;arrow='M48 17 H112 M55 10 L48 17 L55 24 M105 10 L112 17 L105 24';if(type==='twist'){lh=[80+dx,69];rh=[83+dx,69];}}
 if(type==='reach'||type==='arm_pull'){const left=Math.sin(time*2.5)>0;le=left?[48,34]:[52,70];lh=left?[36,8]:[61,63];re=left?[108,70]:[112,34];rh=left?[99,63]:[124,8];arrow=type==='arm_pull'?'M141 15 V53 M134 45 L141 53 L148 45':'M22 65 V22 M15 30 L22 22 L29 30';}
 if(type==='punch'){const left=Math.sin(time*3)>0;le=left?[35,54]:[60,70];lh=left?[15,45]:[68,52];re=left?[100,70]:[125,54];rh=left?[92,52]:[145,45];arrow='M18 30 H48 M112 30 H142';}
 if(type==='pose_hold'){le=[42,49];lh=[12,49];re=[118,49];rh=[148,49];}
 if(seated){lk=[55,110];rk=[105,110];lf=[55,140];rf=[105,140];}
 const line=(pts,color='#eff4e8',w=7)=>`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
 return `<svg viewBox="0 0 160 155" role="img" aria-label="${MOVES[type]?.label??'Movement demonstration'}">${seated?'<path d="M48 97 H112 V140 M48 97 V140" stroke="#82978b" stroke-width="4" fill="none"/>':''}<circle cx="${head[0]}" cy="${head[1]}" r="10" fill="#eff4e8"/>${line([neck,hip])}${line([ls,rs])}${line([ls,le,lh],'#efc26d')}${line([rs,re,rh],'#7ccbd0')}${line([hip,lk,lf])}${line([hip,rk,rf])}<path d="${arrow}" fill="none" stroke="#d5edaa" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
