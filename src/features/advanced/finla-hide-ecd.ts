import { refTextContent } from '@src/utils/reactive-dom';
import { watchEffectWhileNodeAlive } from '@src/utils/watch';
import { observeDescendantListChanged } from '@src/utils/mutation-observer';

function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.LiquidAssetsPanel.row), row => {
    const currency = refTextContent(row.children[0]);
    watchEffectWhileNodeAlive(row, () => {
      row.style.display = currency.value === 'ECD' ? 'none' : '';
    });
  });
  // 将 ECD 列移到末尾以避免破坏
  // 表格行交替色。
  subscribe($$(tile.anchor, 'tbody'), tbody => {
    observeDescendantListChanged(tbody, () => {
      const rows = _$$(tbody, 'tr');
      for (const row of rows) {
        const currency = row.children[0].textContent;
        if (currency !== 'ECD') {
          continue;
        }
        if (row !== tbody.lastChild) {
          tbody.appendChild(row);
        }
        return;
      }
    });
  });
}

function init() {
  tiles.observe('FINLA', onTileReady);
}

features.add(import.meta.url, init, 'FINLA：隐藏 ECD 行。');
