async function focusSearchBar(tile: PrunTile) {
  // 只有无参数的命令才有搜索栏。
  if (tile.parameter) {
    return;
  }
  if (tile.docked) {
    return;
  }
  const input = await $(tile.anchor, 'input');
  input.focus();
}

function init() {
  tiles.observe(['PLI', 'SYSI'], focusSearchBar);
}

features.add(import.meta.url, init, '自动聚焦 PLI 和 SYSI 中的搜索栏。');
