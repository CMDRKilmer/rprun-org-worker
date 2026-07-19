import css from '@src/utils/css-utils.module.css';

function init() {
  // 不幸的是，有两个以 'ContextControls__container' 开头的类名。
  // 而 'ContextControls__container___pADKUO4' 在导入的类中不可用。
  applyCssRule(`.ContextControls__container___pADKUO4 > .${C.HeadItem.container}`, css.hidden);
}

features.add(import.meta.url, init, '隐藏当前上下文名称标签（CTX）。');
