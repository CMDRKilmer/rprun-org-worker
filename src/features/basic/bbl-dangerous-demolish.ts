function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.SectionList.button), buttons => {
    const demolish = buttons.children[1];
    demolish?.classList.add(C.Button.danger);
  });
}

function init() {
  tiles.observe('BBL', onTileReady);
}

features.add(import.meta.url, init, 'BBL：将"危险"样式应用于"拆除"按钮。');
