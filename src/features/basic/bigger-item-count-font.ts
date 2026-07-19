import $style from './bigger-item-count-font.module.css';

function init() {
  applyCssRule(`.${C.MaterialIcon.typeVerySmall}`, $style.indicator);
}

features.add(import.meta.url, init, '增大物品数量标签的字体。');
