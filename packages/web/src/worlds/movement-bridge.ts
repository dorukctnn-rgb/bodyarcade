import type { MovementEvent } from '../../../core/types/index.ts';
/** Pure mapping from BodyArcade's existing detector events to route actions. */
export function routeAction(e:MovementEvent,expected:string|null):string|null{
 if(e.id==='pull'&&e.kind==='rep')return 'arm_pull';
 if(e.id==='twist'&&e.kind==='rep')return 'twist';
 if(e.id==='squat'&&e.kind==='rep')return expected==='duck'?'duck':'squat';
 if(e.id==='lean'&&e.kind==='holdStart')return 'lean';
 return null;
}
