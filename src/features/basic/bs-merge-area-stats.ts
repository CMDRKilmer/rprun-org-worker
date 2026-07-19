import { watchEffectWhileNodeAlive } from '@src/utils/watch';
import { refValue } from '@src/utils/reactive-dom';

function onTileReady(tile: PrunTile) {
  // 仅处理带参数的 BS 磁贴
  if (!tile.parameter) {
    return;
  }

  subscribe($$(tile.anchor, C.Site.info), info => {
    const elements = _$$(info, C.FormComponent.containerPassive);
    if (elements.length < 2) {
      return;
    }

    const areaRow = elements[0];
    areaRow.style.display = 'none';
    const areaBar = areaRow.getElementsByTagName('progress')[0];
    if (areaBar === undefined) {
      return;
    }

    const areaBarCopy = areaBar.cloneNode(true) as HTMLProgressElement;
    const areaValue = refValue(areaBar);
    watchEffectWhileNodeAlive(areaBar, () => (areaBarCopy.value = areaValue.value));
    const editDiv = elements[1].getElementsByTagName('div')[0] as HTMLElement;
    editDiv.insertBefore(areaBarCopy, editDiv.lastChild);
  });
}

function init() {
  tiles.observe('BS', onTileReady);
}

features.add(import.meta.url, init, 'BS：将区域进度条字段与详细区域统计行合并。');
