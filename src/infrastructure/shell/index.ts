// 这些脚本必须无条件执行，以确保即使 rprun 中的其他脚本
// 加载失败，APEX 仍然可以启动。此处的代码还确保
// rprun 的基本功能和更新处理。

import '@src/infrastructure/shell/deserialize-prun-app';
import '@src/infrastructure/shell/config';
import '@src/infrastructure/shell/request-hooks';
import '@src/infrastructure/shell/extension-update';

document.documentElement.classList.add('refined-prun');
