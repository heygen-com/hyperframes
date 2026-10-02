// three/tsl re-exported untyped: the TSL typings are far stricter than the runtime and would need
// a cast on nearly every call. Node graphs stay readable; correctness is checked at shader build time.
import * as tslNS from "three/tsl";
export const tsl: any = tslNS;
