import $style from './highlight-production-order-error.module.css';

function init() {
  applyCssRule(
    'PROD',
    `.${C.OrderSlot.container}:has(.${C.OrderStatus.error})`,
    $style.inputMissingContainer,
  );
  applyCssRule('PRODQ', `tr:has(.${C.OrderStatus.error})`, $style.orderRow);
  applyCssRule(
    'PRODCO',
    `.${C.InputsOutputsView.input}:has(.${C.InputsOutputsView.amountMissing})`,
    $style.inputMissingContainer,
  );
}

features.add(import.meta.url, init, '在 PROD、PRODQ 和 PRODCO 中高亮显示有错误的生产订单。');
