import type { Rng } from '../scene/rng.js';
import type { SceneSpec, ViewId } from '../scene/spec.js';
import amenitiesMap from './amenities-map.js';
import bedroom from './bedroom.js';
import commercialFacade from './commercial-facade.js';
import commercialStreet from './commercial-street.js';
import floorPlan from './floor-plan.js';
import kitchen from './kitchen.js';
import livingRoom from './living-room.js';
import lobby from './lobby.js';
import officeInterior from './office-interior.js';
import park from './park.js';
import plotGate from './plot-gate.js';
import plotMasterplan from './plot-masterplan.js';
import plotStreet from './plot-street.js';
import poolAmenities from './pool-amenities.js';
import towerExterior from './tower-exterior.js';
import villaAerial from './villa-aerial.js';
import villaBackyard from './villa-backyard.js';
import villaFront from './villa-front.js';

export type Scene = (spec: SceneSpec, r: Rng) => string;

/** One file per scene so each can be improved on its own. */
export const SCENES: Record<ViewId, Scene> = {
  'tower-exterior': towerExterior,
  'living-room': livingRoom,
  bedroom,
  kitchen,
  lobby,
  'pool-amenities': poolAmenities,
  'floor-plan': floorPlan,
  'villa-front': villaFront,
  'villa-backyard': villaBackyard,
  'villa-aerial': villaAerial,
  'plot-masterplan': plotMasterplan,
  'plot-gate': plotGate,
  'plot-street': plotStreet,
  park,
  'amenities-map': amenitiesMap,
  'commercial-facade': commercialFacade,
  'commercial-street': commercialStreet,
  'office-interior': officeInterior,
};
