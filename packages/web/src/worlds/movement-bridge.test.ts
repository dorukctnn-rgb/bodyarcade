import {describe,it,expect} from 'vitest';
import {routeAction} from './movement-bridge.ts';
import type {MovementEvent} from '../../../core/types/index.ts';
const event=(id:string,kind:string)=>({id,kind,t:1000} as MovementEvent);
describe('world movement bridge',()=>{
 it('uses complete repetitions, not movement start',()=>{expect(routeAction(event('pull','rep'),'arm_pull')).toBe('arm_pull');expect(routeAction(event('pull','start'),'arm_pull')).toBeNull();});
 it('reuses squat detection for duck stations',()=>{expect(routeAction(event('squat','rep'),'duck')).toBe('duck');expect(routeAction(event('squat','rep'),'squat')).toBe('squat');});
 it('requires a lean hold and passes twist repetitions',()=>{expect(routeAction(event('lean','holdStart'),'lean')).toBe('lean');expect(routeAction(event('lean','holdEnd'),'lean')).toBeNull();expect(routeAction(event('twist','rep'),'twist')).toBe('twist');});
});
