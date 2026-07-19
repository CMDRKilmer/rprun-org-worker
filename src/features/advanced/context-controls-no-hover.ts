import css from '@src/utils/css-utils.module.css';

function init() {
  applyCssRule(`.${C.ContextControls.item}:hover .${C.ContextControls.label}`, css.hidden);
}

features.add(import.meta.url, init, '悬停时阻止上下文控件显示描述信息。');
