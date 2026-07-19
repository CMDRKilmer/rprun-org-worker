import BURN from '@src/features/XIT/BURN/BURN.vue';
import { sitesStore } from '@src/infrastructure/prun-api/data/sites';
import { getEntityNameFromAddress } from '@src/infrastructure/prun-api/data/addresses';

xit.add({
  command: 'BURN',
  name: parameters => {
    if (parameters[0] && !parameters[1]) {
      const site = sitesStore.getByPlanetNaturalIdOrName(parameters[0]);
      if (site) {
        const name = getEntityNameFromAddress(site.address);
        return `消耗品报告 - ${name}`;
      }
    }

    return '消耗品报告';
  },
  description: '显示消耗品剩余天数。',
  optionalParameters: '星球标识符, OVERALL, NOT',
  component: () => BURN,
});
