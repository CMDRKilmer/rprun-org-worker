import css from '@src/utils/css-utils.module.css';
import $style from './hide-item-names.module.css';

function init() {
  applyCssRule(`.${C.GridItemView.name}`, css.hidden);
  // 移除 GridView 中项目之间的间距
  applyCssRule(`.${C.GridItemView.container}`, $style.gridItem);
}

features.add(import.meta.url, init, '隐藏所有库存中的物品名称并移除物品网格间距。');
