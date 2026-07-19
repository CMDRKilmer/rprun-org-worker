import $style from './tile-controls-background.module.css';

function init() {
  applyCssRule(`.${C.TileFrame.controls}`, $style.controls);
}

features.add(import.meta.url, init, '为右上角磁贴控件添加纯色背景。');
