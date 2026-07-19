import PROD from '@src/features/XIT/PROD/PROD.vue';
import { sitesStore } from '@src/infrastructure/prun-api/data/sites';
import { getEntityNameFromAddress } from '@src/infrastructure/prun-api/data/addresses';

xit.add({
  command: 'PROD',
  name: parameters => {
    if (parameters[0] && !parameters[1]) {
      const site = sitesStore.getByPlanetNaturalIdOrName(parameters[0]);
      if (site) {
        const name = getEntityNameFromAddress(site.address);
        return `生产概览 - ${name}`;
      }
    }

    return '生产概览';
  },
  description: '密集的跨基地生产概览。',
  optionalParameters: 'Planet Identifier(s), OVERALL, NOT',
  component: () => PROD,
});
