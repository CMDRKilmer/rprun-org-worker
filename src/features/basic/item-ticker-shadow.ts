import $style from './item-ticker-shadow.module.css';

function init() {
  applyCssRule(`.${C.ColoredIcon.label}`, $style.shadow);
  applyCssRule(`.${C.BuildingIcon.ticker}`, $style.shadow);
}

features.add(import.meta.url, init, '为物品代码添加阴影效果。');
