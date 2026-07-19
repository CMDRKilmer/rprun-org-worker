import { planetsStore } from '@src/infrastructure/prun-api/data/planets';
import { getStarNaturalId, starsStore } from '@src/infrastructure/prun-api/data/stars';

// 该函数接受任何可能是星球名称或自然 ID 的内容。
// 例如：`Phobos`、`Hortus a`、`LoM pAlAnKa`、`wet water a`、`ot-580b`
// 如果已有 naturalIdOrName 的拆分部分，可以传入以避免重新拆分。
export function convertToPlanetNaturalId(naturalIdOrName: string, parts?: string[]) {
  const planet = planetsStore.find(naturalIdOrName);
  if (planet) {
    return planet.naturalId;
  }

  parts ??= naturalIdOrName.split(' ');
  return getPlanetNaturalIdByStarName(parts);
}

// 例如，`Hortus a`：其中 `Hortus` 是星系名称，`a` 是星球字母。
// 返回值为 `VH-331a`（`VH-331` 是 `Hortus` 的星系自然 ID）。
function getPlanetNaturalIdByStarName(parts: string[]) {
  if (parts.length < 2) {
    return undefined;
  }

  const systemName = parts.slice(0, -1).join(' ');
  const star = starsStore.find(systemName);
  if (star) {
    return getStarNaturalId(star) + parts[parts.length - 1];
  }

  return undefined;
}
