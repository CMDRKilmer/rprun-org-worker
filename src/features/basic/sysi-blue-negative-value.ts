import $style from './sysi-blue-negative-value.module.css';

function onTileReady(tile: PrunTile) {
  subscribe($$(tile.anchor, C.ColoredValue.negative), negative => {
    if (negative.textContent?.includes('▼')) {
      negative.classList.add($style.lowValue);
    }
  });
}

function init() {
  tiles.observe('SYSI', onTileReady);
}

features.add(import.meta.url, init, 'SYSI：将较低的行星负值显示为蓝色而非红色。');
