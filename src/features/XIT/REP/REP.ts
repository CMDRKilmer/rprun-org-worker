import REP from '@src/features/XIT/REP/REP.vue';
import { getEntityNaturalIdFromAddress } from '@src/infrastructure/prun-api/data/addresses';
import { getParameterSites } from './entries';

xit.add({
  command: ['REP', 'REPAIR', 'REPAIRS'],
  name: '维修材料',
  description: '显示维修建筑所需的材料。',
  optionalParameters: '星球标识符',
  contextItems: parameters => {
    if (parameters.length === 0) {
      return [{ cmd: 'BRA' }];
    }
    const sites = getParameterSites(parameters) ?? [];
    return sites.map(x => ({ cmd: `BRA ${getEntityNaturalIdFromAddress(x.address)}` }));
  },
  component: () => REP,
});
