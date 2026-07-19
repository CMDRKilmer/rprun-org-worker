import $style from './inv-search.module.css';
import css from '@src/utils/css-utils.module.css';

function onTileReady(tile: PrunTile) {
  // 仅在主 INV 磁贴中添加搜索栏
  if (tile.parameter) {
    return;
  }

  subscribe($$(tile.anchor, C.InventoriesListContainer.filter), async inventoryFilters => {
    const tableBody = await $(tile.anchor, 'tbody');

    const onInput = (e: Event) => {
      const input = e.target as HTMLInputElement;
      for (let i = 0; i < tableBody.children.length; i++) {
        const row = tableBody.children[i] as HTMLElement;
        if (filterRow(row, input.value)) {
          row.classList.remove(css.hidden);
        } else {
          row.classList.add(css.hidden);
        }
      }
    };

    createFragmentApp(() => (
      <div>
        <input class={$style.inputText} placeholder="输入位置" onInput={onInput} />
      </div>
    )).after(inventoryFilters);
  });
}

function filterRow(row: HTMLElement, search: string) {
  if (!search || search === '') {
    // 搜索为空时始终返回所有行
    return true;
  }

  // 库存的位置
  const location = row.children[1].textContent!.toLowerCase();
  if (location !== '--') {
    // 将搜索文本与位置名称进行匹配
    if (location.includes(search.toLowerCase())) {
      return true;
    }
  }

  // 船舶名称（非船舶库存为 '')
  const name = row.children[2].textContent!.toLowerCase();
  if (name !== '') {
    // 将搜索文本与船舶名称进行匹配
    if (name.includes(search.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function init() {
  tiles.observe(['INV', 'SHPI'], onTileReady);
}

features.add(import.meta.url, init, 'INV/SHPI：在主 INV 缓冲区添加搜索栏。');
