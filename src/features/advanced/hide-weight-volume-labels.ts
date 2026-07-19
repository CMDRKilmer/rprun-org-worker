import css from '@src/utils/css-utils.module.css';

function init() {
  applyCssRule(`.${C.StoreView.name}`, css.hidden);
}

features.add(import.meta.url, init, '隐藏所有库存中的"重量"和"体积"标签。');
