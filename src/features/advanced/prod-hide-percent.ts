import css from '@src/utils/css-utils.module.css';

function init() {
  applyCssRule('PROD', `.${C.OrderStatus.inProgress}`, css.hidden);
}

features.add(import.meta.url, init, 'PROD：隐藏订单列表中的百分比值。');
