function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.Message.controls), async controls => {
    const button = await $(controls, C.Button.btn);
    button.addEventListener('click', e => {
      if (e.shiftKey) {
        return;
      }

      button.setAttribute(
        'data-tooltip',
        'Please hold shift when clicking this button (misclick prevention)',
      );
      button.setAttribute('data-tooltip-position', 'top');
      e.preventDefault();
      e.stopPropagation();
    });
  });
}

function init() {
  tiles.observe(['COMG', 'COMP', 'COMU'], onTileReady);
}

features.add(import.meta.url, init, '使聊天中的"删除"按钮仅在按住 Shift 时生效。');
