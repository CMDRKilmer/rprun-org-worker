import $style from './cxpo-bigger-buttons.module.css';

function init() {
  applyCssRule(
    'CXPO',
    `.${C.FormComponent.containerCommand} .${C.FormComponent.input}`,
    $style.container,
  );
}

features.add(import.meta.url, init, 'CXPO：增大"买入"和"卖出"按钮。');
