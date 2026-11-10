const station=(at,name,event,reps,source,seatedEvent=event)=>({at,name,event,reps,source,seatedEvent,rest:12});
export const ROUTES={
 forest:{id:'forest',name:'Forest',subtitle:'Explore beneath the pines',color:'#b8d49b',length:260,ground:'forest-dirt.webp',stations:[
 station(12,'Duck under the branch','duck',4,'Road Run','lean'),station(52,'Reach for the fruit','reach',8,'Star Catch'),station(96,'Pull the hanging ropes','arm_pull',10,'Summit Climb'),station(142,'Rise above the rocks','squat',6,'Squat Flap','reach'),station(190,'Hold your balance','pose_hold',4,'Pose Wall'),station(236,'Gather the last fruit','reach',8,'Star Catch')]},
 lake:{id:'lake',name:'Lake',subtitle:'Move gently along the water',color:'#a2dce0',length:280,ground:'lake-wood.webp',stations:[
 station(12,'Reach along the boardwalk','reach',8,'Star Catch'),station(56,'Pull the ropes, alternate arms','arm_pull',10,'Summit Climb'),station(104,'Turn the lakeside mechanism','twist',8,'Twist Turbine'),station(154,'Lean through the rocks','lean',6,'Road Run'),station(208,'Balance on the narrow pier','pose_hold',4,'Pose Wall'),station(256,'Pull open the lookout','arm_pull',10,'Summit Climb')]},
 city:{id:'city',name:'City',subtitle:'Find your rhythm in Mediterranean streets',color:'#f3c99b',length:300,ground:'city-stone.webp',stations:[
 station(12,'Reach for the hanging fruit','reach',8,'Star Catch'),station(62,'Push the light crates aside','punch',12,'Pad Work'),station(114,'Power the street lights','twist',10,'Twist Turbine'),station(170,'Duck under the awning','duck',4,'Road Run','lean'),station(230,'Pull the market ropes','arm_pull',10,'Summit Climb'),station(276,'Hold the plaza pose','pose_hold',4,'Pose Wall')]}
};
export const MOVES={reach:{label:'Reach out, alternate arms',key:'E',icon:'↗'},arm_pull:{label:'Reach up, pull to shoulder; switch arms',key:'R',icon:'↧'},duck:{label:'Duck down, then stand tall',key:'C',icon:'↓'},squat:{label:'Squat down, then stand tall',key:'S',icon:'⇵'},lean:{label:'Lean left, return, then lean right',key:'A',icon:'↔'},twist:{label:'Turn your shoulders left and right',key:'T',icon:'⤾'},punch:{label:'Punch left and right at the targets',key:'P',icon:'◎'},pose_hold:{label:'Extend both arms sideways; hold for 1 second',key:'H',icon:'✦'}};
export const routeX=(d,id)=>id==='city'?Math.sin(d/55)*2:Math.sin(d/28)*(id==='lake'?2.5:4.5);
// Product tuning values, not medical or physiological intensity measurements.
export const LEVELS={
 beginner:{label:'Beginner',repScale:1,rest:20,speed:1.6,credit:5,tempo:24,prepare:4},
 intermediate:{label:'Intermediate',repScale:1.5,rest:14,speed:2.1,credit:4,tempo:32,prepare:3},
 hard:{label:'Hard',repScale:2,rest:10,speed:2.6,credit:3,tempo:40,prepare:3}
};
