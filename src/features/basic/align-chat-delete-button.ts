import $style from './align-chat-delete-button.module.css';

function init() {
  applyCssRule(`.${C.Message.controlsAndText}`, $style.container);
  applyCssRule(`.${C.Message.controls}`, $style.delete);
  applyCssRule(
    `.${C.Message.message}:has(.${C.Message.controlsAndText} .${C.Message.controls}) .${C.Sender.name}`,
    $style.username,
  );
}

features.add(import.meta.url, init, '移动"删除"按钮以防止聊天消息布局偏移。');
