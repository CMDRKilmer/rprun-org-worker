import { refAnimationFrame } from '@src/utils/reactive-dom';
import { isEmpty } from 'ts-extras';

function onTileReady(tile: PrunTile) {
  // 仅处理带参数的 BS 磁贴
  if (!tile.parameter) {
    return;
  }

  subscribe($$(tile.anchor, C.Site.workforces), workforces => {
    subscribe($$(workforces, 'tr'), row => {
      const cells = _$$(row, 'td');
      if (isEmpty(cells)) {
        return;
      }

      const bar = cells[4].getElementsByTagName('div')[0];
      bar.style.display = 'flex';
      bar.style.flexDirection = 'row';
      bar.style.justifyContent = 'left';
      const progress = bar.getElementsByTagName('progress')[0];
      const progressTitle = refAnimationFrame(progress, x => x.title);
      createFragmentApp(() => <span>{progressTitle.value}</span>).appendTo(bar);
    });
  });
}

function init() {
  tiles.observe('BS', onTileReady);
}

features.add(import.meta.url, init, 'BS：在满意度进度条上添加劳动力满意度百分比标签。');
