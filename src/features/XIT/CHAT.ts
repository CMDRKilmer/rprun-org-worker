import CHAT from '@src/features/XIT/CHAT.vue';

xit.add({
  command: 'CHAT',
  name: 'FIO 聊天',
  description: '提供星球聊天的只读访问。',
  mandatoryParameters: '星球标识符',
  component: () => CHAT,
});
