import { materialsStore } from '@src/infrastructure/prun-api/data/materials';
import {
  materialCategoriesStore,
  toSerializableCategoryName,
} from '@src/infrastructure/prun-api/data/material-categories';
import { showBuffer } from '@src/infrastructure/prun-ui/buffers';

function onTileReady(tile: PrunTile) {
  const parameter = tile.parameter;
  const material = materialsStore.getByTicker(parameter);
  const category = materialCategoriesStore.getById(material?.category);
  if (!category) {
    return;
  }

  subscribe($$(tile.anchor, C.MaterialInformation.container), async container => {
    const fields = _$$(container, C.StaticInput.static);
    const categoryField = fields[1];
    if (categoryField === undefined) {
      return;
    }

    categoryField.classList.add(C.Link.link);
    categoryField.addEventListener('click', e => {
      showBuffer('XIT MATS ' + toSerializableCategoryName(category.name));
      e.preventDefault();
      e.stopPropagation();
    });
  });
}

function init() {
  tiles.observe('MAT', onTileReady);
}

features.add(import.meta.url, init, 'MAT：使材料类别可点击并跳转到对应类别的 XIT MATS。');
