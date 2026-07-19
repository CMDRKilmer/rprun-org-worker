function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.ShipStore.store), div => {
    // div -> div（DOM 结构）
    const label = div.children[2];
    if (label !== undefined) {
      label.textContent = (label.textContent || '')
        .replace(/(t|m³)/g, '')
        .replace(/(\d+)([,.]?000)/g, (_, x) => `${x}k`);
    }
  });
}

function init() {
  tiles.observe(['FLT', 'FLTS', 'FLTP'], onTileReady);
}

features.add(import.meta.url, init, 'FLT：移除"t"和"m³"并将货舱容量标签转换为千位表示法。');
