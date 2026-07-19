import css from '@src/utils/css-utils.module.css';

function init() {
  const selector = `.${C.Tile.tile} .${C.TileControls.splitControls} + .${C.TileControls.control}`;
  applyCssRule(`.${C.MainState.tileContainer} > ${selector}`, css.hidden);
  applyCssRule(`.${C.Window.body} > ${selector}`, css.hidden);
}

features.add(import.meta.url, init, '隐藏单磁贴窗口中无功能的关闭按钮。');
