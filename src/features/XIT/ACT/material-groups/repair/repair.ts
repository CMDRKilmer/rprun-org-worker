import { act } from '@src/features/XIT/ACT/act-registry';
import Edit from '@src/features/XIT/ACT/material-groups/repair/Edit.vue';
import Configure from '@src/features/XIT/ACT/material-groups/repair/Configure.vue';
import { getBuildingLastRepair, sitesStore } from '@src/infrastructure/prun-api/data/sites';
import { isRepairableBuilding } from '@src/core/buildings';
import { Config } from '@src/features/XIT/ACT/material-groups/repair/config';
import { configurableValue } from '@src/features/XIT/ACT/shared-types';

act.addMaterialGroup<Config>({
  type: 'Repair',
  description: data => {
    if (!data.planet) {
      return '--';
    }

    const days = data.days;
    const daysPart = days !== undefined ? `超过 ${days} 天` : '';
    const advanceDays = data.advanceDays ?? 0;
    return `修复 ${data.planet} 上${daysPart}的建筑，提前 ${advanceDays} 天`;
  },
  editComponent: Edit,
  configureComponent: Configure,
  needsConfigure: data => data.planet === configurableValue,
  isValidConfig: (data, config) => data.planet !== configurableValue || config.planet !== undefined,
  generateMaterialBill: async ({ data, config, log }) => {
    if (!data.planet) {
      log.error('未配置补给星球');
      return undefined;
    }

    const planet = data.planet === configurableValue ? config.planet : data.planet;
    const site = sitesStore.getByPlanetNaturalIdOrName(planet);
    if (!site?.platforms) {
      log.error('缺少修复星球数据');
      return undefined;
    }

    const days = typeof data.days === 'number' ? data.days : parseFloat(data.days!);
    let advanceDays =
      typeof data.advanceDays === 'number' ? data.advanceDays : parseFloat(data.advanceDays!);
    const threshold = isNaN(days) ? 0 : days;
    advanceDays = isNaN(advanceDays) ? 0 : advanceDays;

    const parsedGroup = {};
    for (const building of site.platforms) {
      if (!isRepairableBuilding(building)) {
        continue;
      }

      const lastRepair = getBuildingLastRepair(building);
      const date = (new Date().getTime() - lastRepair) / 86400000;

      if (date + advanceDays < threshold) {
        continue;
      }

      const buildingMaterials = {};
      for (const mat of building.reclaimableMaterials) {
        const amount = mat.amount;
        const ticker = mat.material.ticker;
        if (buildingMaterials[ticker]) {
          buildingMaterials[ticker] += amount;
        } else {
          buildingMaterials[ticker] = amount;
        }
      }
      for (const mat of building.repairMaterials) {
        const amount = mat.amount;
        const ticker = mat.material.ticker;
        if (buildingMaterials[ticker]) {
          buildingMaterials[ticker] += amount;
        } else {
          buildingMaterials[ticker] = amount;
        }
      }

      const adjustedDate = date + advanceDays;
      for (const ticker of Object.keys(buildingMaterials)) {
        const amount =
          adjustedDate > 180
            ? buildingMaterials[ticker]
            : // This isn't quite right, but will be off by only 1 MCG at most
              Math.ceil((buildingMaterials[ticker] * adjustedDate) / 180);

        if (parsedGroup[ticker]) {
          parsedGroup[ticker] += amount;
        } else {
          parsedGroup[ticker] = amount;
        }
      }
    }
    return parsedGroup;
  },
});
